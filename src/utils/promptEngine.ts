/**
 * Advanced Prompt Engine with Chain of Thought and Quality Improvements
 *
 * Features:
 * - Chain of Thought prompting for better outline generation
 * - Negative prompts for improved image quality
 * - Rich visual style descriptors
 * - Semantic consistency support for multi-page narratives
 */

import type { BookSettings } from '../types';

/**
 * Visual style descriptors for image generation
 * Maps style slider (0-1) to detailed artistic descriptors
 */
const VISUAL_STYLES = {
  cartoonish: {
    positive: 'watercolor hand-drawn illustration, soft pastel colors, storybook style, gentle lines, whimsical, children\'s book illustration, warm lighting, friendly atmosphere',
    negative: 'photorealistic, 3d render, dark, scary, complex details, sharp edges, photographic, realistic',
  },
  balanced: {
    positive: 'digital art, clean lines, vibrant colors, educational illustration, modern flat design, clear visual hierarchy, engaging, professional',
    negative: 'blurry, low quality, distorted, malformed, text overlay, watermark, signature, dark, gloomy',
  },
  realistic: {
    positive: 'cinematic photography, hyper-realistic, 8k ultra detailed, dramatic lighting, professional photography, depth of field, sharp focus, National Geographic style',
    negative: 'cartoon, illustration, drawing, painting, cgi, 3d render, blurry, low quality, distorted, deformed',
  },
} as const;

/**
 * Level-based content specifications
 */
const LEVEL_SPECS = {
  Toddler: {
    audience: 'a very young child (ages 3-5)',
    vocabulary: 'simple, basic words only, no jargon',
    sentenceStructure: 'short sentences (5-10 words), repetitive patterns',
    concepts: 'concrete, tangible ideas only, relate to daily life',
    wordLimit: 60,
    examplePrompt: 'Think: "What would a curious 4-year-old ask?"',
  },
  Student: {
    audience: 'a middle-school student (ages 11-14)',
    vocabulary: 'clear educational language, introduce technical terms with explanations',
    sentenceStructure: 'varied sentence length, logical flow',
    concepts: 'mix of concrete and abstract, build on prior knowledge',
    wordLimit: 100,
    examplePrompt: 'Think: "How would a science teacher explain this to an engaged student?"',
  },
  Expert: {
    audience: 'an academic or professional audience',
    vocabulary: 'precise technical terminology, field-specific language',
    sentenceStructure: 'complex sentences, nuanced explanations',
    concepts: 'abstract theories, mechanisms, edge cases, current research',
    wordLimit: 150,
    examplePrompt: 'Think: "What would a subject matter expert want to know?"',
  },
} as const;

/**
 * Generate Chain of Thought outline prompt
 * Uses step-by-step reasoning to create better-structured outlines
 */
export const generateOutlinePrompt = (subject: string, settings: BookSettings, numPages = 3): string => {
  const { level } = settings;
  const levelSpec = LEVEL_SPECS[level] || LEVEL_SPECS.Student;

  return `You are creating a ${numPages}-page educational book about "${subject}" for ${levelSpec.audience}.

Use Chain of Thought reasoning to plan this book:

Step 1 - Analyze the topic:
- What are the 3-5 core concepts needed to understand "${subject}"?
- What prerequisite knowledge does the reader need?
- What would be the most surprising or interesting aspect?

Step 2 - Plan the narrative arc:
- Page 1 should introduce the topic and hook the reader
- Middle pages should build understanding progressively
- Final page should provide closure and a "big picture" insight

Step 3 - Consider the audience:
- ${levelSpec.examplePrompt}
- Vocabulary level: ${levelSpec.vocabulary}
- Concepts: ${levelSpec.concepts}

Step 4 - Create the outline:
For each of the ${numPages} pages, determine:
- A compelling title (3-5 words)
- The single most important focus/concept to cover

Now output ONLY a JSON array with exactly ${numPages} objects. Each object must have:
- "title": string (3-5 words, engaging and descriptive)
- "focus": string (one sentence describing the main concept for this page)

Format example:
[{"title": "The Magic of Black Holes", "focus": "Introduction to what black holes are and why they're mysterious"}, {"title": "Event Horizons Explained", "focus": "Understanding the point of no return around black holes"}, {"title": "Journey to the Singularity", "focus": "What happens at the center of a black hole"}]

IMPORTANT: Return ONLY the JSON array. No other text, no explanations, no markdown.`;
};

/**
 * Generate enhanced text prompt with semantic consistency support
 */
export const generatePrompt = (
  subject: string,
  settings: BookSettings,
  pageNum: number | null = null,
  totalPages: number | null = null,
  previousPageContent: string | null = null
): { textPrompt: string; imagePrompt: { positive: string; negative: string } } => {
  const { tone, style, level, complexity } = settings;
  const levelSpec = LEVEL_SPECS[level] || LEVEL_SPECS.Student;

  // Level mapping
  const levelText = levelSpec.audience;

  // Tone mapping (0.0 to 1.0)
  const toneInstruction = tone > 0.7
    ? "Use silly puns, jokes, and a very whimsical, fun tone. Make the reader smile!"
    : tone < 0.3
      ? "Use formal, precise, and academic language. Prioritize accuracy over entertainment."
      : "Use a friendly and informative tone. Balance engagement with clarity.";

  // Complexity mapping (0.0 to 1.0)
  const complexityInstruction = complexity > 0.7
    ? "Dive into deep theory, underlying mechanisms, and nuanced details. Don't oversimplify."
    : complexity < 0.3
      ? "Use simple analogies and focus on basic concepts. Relate to everyday experiences."
      : "Balance basic concepts with interesting details. Build understanding progressively.";

  // Multi-page context
  const pageContext = pageNum !== null && totalPages !== null
    ? `This is page ${pageNum} of ${totalPages}. `
    : '';

  // Semantic consistency: reference previous page content
  const consistencyInstruction = previousPageContent
    ? `\n\nBuild on the previous page's content:\n"${previousPageContent}"\n\nContinue the narrative naturally. Reference key concepts from above if relevant, but don't simply repeat them. Maintain consistency in terminology and explanations.`
    : '';

  return {
    textPrompt: `${pageContext}Explain ${subject} for ${levelText}.

${toneInstruction} ${complexityInstruction}

Key requirements:
- Limit to approximately ${levelSpec.wordLimit} words
- Include one surprising or counterintuitive fact
- Use clear examples or analogies
- End with a thought-provoking insight or question${consistencyInstruction}`,

    imagePrompt: generateImagePrompt(subject, style, pageNum),
  };
};

/**
 * Generate enhanced image prompt with style descriptors and negative prompts
 */
export const generateImagePrompt = (
  subject: string,
  style: number = 0.5,
  pageNum: number | null = null
): { positive: string; negative: string } => {
  // Determine visual style category
  let styleCategory: 'cartoonish' | 'balanced' | 'realistic';
  if (style < 0.3) {
    styleCategory = 'cartoonish';
  } else if (style > 0.7) {
    styleCategory = 'realistic';
  } else {
    styleCategory = 'balanced';
  }

  const styleDesc = VISUAL_STYLES[styleCategory];

  // Build the positive prompt
  const positiveParts = [
    styleDesc.positive,
    `educational illustration about ${subject}`,
    'bright, appealing colors',
    'high quality, professional',
    'clear focal point',
    'well-composed',
  ];

  // Add page-specific context if available
  if (pageNum !== null) {
    positiveParts.push(`page ${pageNum} of educational book`);
  }

  const positivePrompt = positiveParts.join(', ');

  return {
    positive: positivePrompt,
    negative: styleDesc.negative,
  };
};

/**
 * Extract just the positive prompt string for backward compatibility
 */
export const generateImagePromptString = (
  subject: string,
  style: number = 0.5,
  pageNum: number | null = null
): string => {
  const { positive } = generateImagePrompt(subject, style, pageNum);
  return positive;
};

/**
 * Generate a quip prompt for the narrator
 */
export const generateQuipPrompt = (content: string, subject: string): string => {
  return `You are Logic the Lemur, a sassy, playful character who loves learning and isn't afraid to point out the funny stuff.

Your personality:
- Witty and quick with observations
- Friendly, never mean
- Breaks the fourth wall
- Makes learning fun

Read this educational content about "${subject}":
---
${content}
---

Now make a short, witty comment (max 15 words) that:
- Reacts to something specific in the content
- Is funny or surprising
- Feels like a friend commenting while you read

Just return the quip, nothing else. No quotes, no explanations.`;
};

/**
 * Generate a negative prompt for image generation based on style
 */
export const generateNegativePrompt = (style: number = 0.5): string => {
  const styleCategory = style < 0.3 ? 'cartoonish' : style > 0.7 ? 'realistic' : 'balanced';
  return VISUAL_STYLES[styleCategory].negative;
};

/**
 * Get style descriptors for UI display
 */
export const getStyleDescription = (style: number = 0.5): { label: string; description: string } => {
  if (style < 0.3) {
    return { label: 'Cartoonish', description: 'Watercolor, hand-drawn, storybook style' };
  } else if (style > 0.7) {
    return { label: 'Realistic', description: 'Photographic, cinematic, hyper-detailed' };
  } else {
    return { label: 'Digital Art', description: 'Clean, modern, educational illustration' };
  }
};

export default {
  generatePrompt,
  generateOutlinePrompt,
  generateQuipPrompt,
  generateImagePrompt,
  generateImagePromptString,
  generateNegativePrompt,
  getStyleDescription,
  LEVEL_SPECS,
  VISUAL_STYLES,
};
