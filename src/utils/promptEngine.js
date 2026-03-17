/**
 * Logic to turn slider values into LLM instructions.
 */

export const generatePrompt = (subject, settings, pageNum = null, totalPages = null) => {
  const { tone, style, level, complexity } = settings;

  // Level mapping
  const levelText = {
    'Toddler': 'a very young child, using simple words and concepts',
    'Student': 'a middle-school student, with clear and educational language',
    'Expert': 'an academic audience, using technical terms and deep theory'
  }[level] || 'a general audience';

  // Tone mapping (0.0 to 1.0)
  const toneInstruction = tone > 0.7
    ? "Use silly puns, jokes, and a very whimsical, fun tone."
    : tone < 0.3
      ? "Use formal, precise, and academic language."
      : "Use a friendly and informative tone.";

  // Visual Style mapping (0.0 to 1.0)
  const visualKeyword = style > 0.7
    ? "cinematic, hyper-realistic photography, 8k, detailed"
    : style < 0.3
      ? "watercolor, hand-drawn illustration, soft colors, storybook style"
      : "digital art, clean lines, vibrant colors, educational illustration";

  // Complexity mapping (0.0 to 1.0)
  const complexityInstruction = complexity > 0.7
    ? "Dive into deep theory and complex mechanisms."
    : complexity < 0.3
      ? "Use simple analogies and focus on basic concepts."
      : "Balance basic concepts with interesting details.";

  // Multi-page context
  const pageContext = pageNum !== null && totalPages !== null
    ? `This is page ${pageNum} of ${totalPages}. `
    : '';

  return {
    textPrompt: `${pageContext}Explain ${subject} for ${levelText}. ${toneInstruction} ${complexityInstruction} Limit to 100 words. Mention one surprising fact.`,
    imagePrompt: `A ${visualKeyword} depicting ${subject}, educational, bright colors, high quality.`
  };
};

/**
 * Generate an outline prompt for multi-page books
 */
export const generateOutlinePrompt = (subject, settings, numPages = 3) => {
  const { level } = settings;

  const levelText = {
    'Toddler': 'a very young child',
    'Student': 'a middle-school student',
    'Expert': 'an academic audience'
  }[level] || 'a general audience';

  return `Create a ${numPages}-page book outline about "${subject}" for ${levelText}.
Return ONLY a JSON array with exactly ${numPages} objects, each with:
- "title": short page title (3-5 words)
- "focus": one sentence describing what this page should cover

Example format:
[{"title": "Page 1 Title", "focus": "What this page covers"}, {"title": "Page 2 Title", "focus": "Next topic"}]

Do not include any other text. Just the JSON array.`;
};

/**
 * Generate a quip prompt for the narrator
 */
export const generateQuipPrompt = (content, subject) => {
  return `Act as Logic the Lemur, a sassy, playful character. 
Look at this educational content about "${subject}":
"${content}"

Make a short, witty, 1-sentence comment (max 15 words) that breaks the fourth wall. 
Be funny and friendly, like you're reacting to what you just read.
Just return the quip, nothing else.`;
};
