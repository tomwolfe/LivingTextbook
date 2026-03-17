/**
 * Generation Worker - Handles book generation orchestration off the main thread
 *
 * This worker manages the generation queue and coordinates text/image/quip generation.
 * It sends model operation requests to the main thread and receives results back.
 * This keeps the UI thread responsive at 60fps during queue management logic.
 */

let generationQueue = [];
let isGenerating = false;
let currentSettings = null;
let currentNumPages = 0;
let generatedPages = []; // Store generated pages for semantic consistency

/**
 * Generate prompts for a page
 */
function generatePagePrompts(pageNum, pageOutline) {
  // Get previous page content for semantic consistency (if not first page)
  const previousPageContent = pageNum > 0 ? generatedPages[pageNum - 1]?.content : null;

  // Import generatePrompt from main thread via message
  return new Promise((resolve) => {
    self.postMessage({
      type: 'MODEL_REQUEST',
      requestType: 'GENERATE_PROMPT',
      payload: {
        subject: currentSettings.subject,
        settings: currentSettings,
        pageNum: pageNum + 1,
        totalPages: currentNumPages,
        pageOutline,
        previousPageContent,
      },
    });

    const handler = (event) => {
      if (event.data.type === 'MODEL_RESPONSE' && event.data.requestType === 'GENERATE_PROMPT') {
        self.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };
    self.addEventListener('message', handler);
  });
}

/**
 * Generate text from a prompt
 */
function generateTextContent(prompt) {
  return new Promise((resolve) => {
    self.postMessage({
      type: 'MODEL_REQUEST',
      requestType: 'GENERATE_TEXT',
      payload: { prompt },
    });

    const handler = (event) => {
      if (event.data.type === 'MODEL_RESPONSE' && event.data.requestType === 'GENERATE_TEXT') {
        self.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };
    self.addEventListener('message', handler);
  });
}

/**
 * Generate image from a prompt
 */
function generateImageContent(prompt) {
  return new Promise((resolve) => {
    self.postMessage({
      type: 'MODEL_REQUEST',
      requestType: 'GENERATE_IMAGE',
      payload: { prompt },
    });

    const handler = (event) => {
      if (event.data.type === 'MODEL_RESPONSE' && event.data.requestType === 'GENERATE_IMAGE') {
        self.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };
    self.addEventListener('message', handler);
  });
}

/**
 * Generate a quip from content
 */
function generateQuipContent(quipPrompt, subject) {
  return new Promise((resolve) => {
    self.postMessage({
      type: 'MODEL_REQUEST',
      requestType: 'GENERATE_QUIP',
      payload: { prompt: quipPrompt, subject },
    });

    const handler = (event) => {
      if (event.data.type === 'MODEL_RESPONSE' && event.data.requestType === 'GENERATE_QUIP') {
        self.removeEventListener('message', handler);
        resolve(event.data.result);
      }
    };
    self.addEventListener('message', handler);
  });
}

/**
 * Generate a single page with text, image, and quip
 */
async function generatePage(pageNum, pageOutline) {
  // Step 1: Get prompts from main thread (includes previous page context)
  const { textPrompt, imagePrompt } = await generatePagePrompts(pageNum, pageOutline);

  // Add page-specific context from outline
  const enhancedTextPrompt = `${textPrompt}\n\nFocus on: ${pageOutline.focus}`;

  // Step 2: Generate text and image in parallel (main thread does heavy lifting)
  const [content, imageResult] = await Promise.all([
    generateTextContent(enhancedTextPrompt),
    generateImageContent(imagePrompt),
  ]);

  // Step 3: Generate quip after content is ready
  let quip = null;
  if (content) {
    // Import generateQuipPrompt from main thread
    self.postMessage({
      type: 'MODEL_REQUEST',
      requestType: 'GENERATE_QUIP_PROMPT',
      payload: { content, subject: currentSettings.subject },
    });

    const quipPromptResult = await new Promise((resolve) => {
      const handler = (event) => {
        if (event.data.type === 'MODEL_RESPONSE' && event.data.requestType === 'GENERATE_QUIP_PROMPT') {
          self.removeEventListener('message', handler);
          resolve(event.data.result);
        }
      };
      self.addEventListener('message', handler);
    });

    quip = await generateQuipContent(quipPromptResult.quipPrompt, currentSettings.subject);
  }

  // Store this page's content for semantic consistency with next page
  generatedPages[pageNum] = { content, title: pageOutline.title };

  return {
    title: pageOutline.title,
    content: content || 'Content generation failed.',
    image: imageResult,
    quip: quip,
    settings: { ...currentSettings },
  };
}

/**
 * Process the generation queue
 */
async function processGenerationQueue() {
  if (isGenerating || generationQueue.length === 0) return;

  isGenerating = true;

  while (generationQueue.length > 0) {
    const { pageNum, pageOutline } = generationQueue.shift();

    // Notify main thread that we're starting this page
    self.postMessage({
      type: 'PAGE_START',
      pageNum,
    });

    try {
      const pageData = await generatePage(pageNum, pageOutline);

      // Send generated page data back to main thread
      self.postMessage({
        type: 'PAGE_COMPLETE',
        pageNum,
        pageData,
      });
    } catch (err) {
      console.error(`Worker: Failed to generate page ${pageNum}:`, err);
      self.postMessage({
        type: 'PAGE_ERROR',
        pageNum,
        error: err.message || 'Generation failed',
      });
    }
  }

  isGenerating = false;

  // Notify queue completion
  self.postMessage({
    type: 'QUEUE_COMPLETE',
  });
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START_GENERATION': {
      const { settings, outline, numPages } = payload;

      // Store context for this generation session
      currentSettings = settings;
      currentNumPages = numPages;

      // Reset state
      generationQueue = [];
      isGenerating = false;
      generatedPages = []; // Reset semantic consistency cache

      // Queue all pages for generation
      generationQueue = outline.map((pageOutline, idx) => ({
        pageNum: idx,
        pageOutline,
      }));

      // Start processing - first page immediately
      await processGenerationQueue();
      break;
    }

    case 'RESUME_GENERATION': {
      // Continue processing remaining queued pages
      setTimeout(() => {
        processGenerationQueue();
      }, 500);
      break;
    }

    case 'CANCEL_GENERATION': {
      generationQueue = [];
      isGenerating = false;
      self.postMessage({
        type: 'GENERATION_CANCELLED',
      });
      break;
    }

    default:
      console.warn('Worker: Unknown message type:', type);
  }
};

// Initial ready message
self.postMessage({ type: 'WORKER_READY' });
