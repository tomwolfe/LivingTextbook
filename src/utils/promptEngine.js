/**
 * Logic to turn slider values into LLM instructions.
 */

export const generatePrompt = (subject, settings) => {
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

  return {
    textPrompt: `Explain ${subject} for ${levelText}. ${toneInstruction} ${complexityInstruction} Limit to 100 words. Mention one surprising fact.`,
    imagePrompt: `A ${visualKeyword} depicting ${subject}, educational, bright colors, high quality.`
  };
};
