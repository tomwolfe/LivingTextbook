/**
 * Unit tests for promptEngine utility
 * Tests prompt generation logic, style mapping, and level specifications
 */

import { describe, it, expect } from 'vitest';
import {
  generatePrompt,
  generateImagePrompt,
  generateQuipPrompt,
  generateNegativePrompt,
  getStyleDescription,
  LEVEL_SPECS,
  VISUAL_STYLES,
} from './promptEngine';
import type { BookSettings } from '../types';

describe('promptEngine', () => {
  const baseSettings: BookSettings = {
    subject: 'Black Holes',
    tone: 0.5,
    style: 0.5,
    complexity: 0.5,
    level: 'Student',
  };

  describe('generatePrompt', () => {
    it('should generate text prompt with correct level specifications', () => {
      const result = generatePrompt('Black Holes', baseSettings);
      
      expect(result.textPrompt).toContain('Black Holes');
      expect(result.textPrompt).toContain('middle-school student');
      expect(result.imagePrompt).toBeDefined();
    });

    it('should adjust tone based on settings', () => {
      const funSettings: BookSettings = { ...baseSettings, tone: 0.9 };
      const academicSettings: BookSettings = { ...baseSettings, tone: 0.1 };

      const funResult = generatePrompt('Black Holes', funSettings);
      const academicResult = generatePrompt('Black Holes', academicSettings);

      expect(funResult.textPrompt).toContain('silly puns');
      expect(funResult.textPrompt).toContain('whimsical');
      expect(academicResult.textPrompt).toContain('formal');
      expect(academicResult.textPrompt).toContain('academic');
    });

    it('should adjust complexity based on settings', () => {
      const deepSettings: BookSettings = { ...baseSettings, complexity: 0.9 };
      const simpleSettings: BookSettings = { ...baseSettings, complexity: 0.1 };

      const deepResult = generatePrompt('Black Holes', deepSettings);
      const simpleResult = generatePrompt('Black Holes', simpleSettings);

      expect(deepResult.textPrompt).toContain('deep theory');
      expect(simpleResult.textPrompt).toContain('simple analogies');
    });

    it('should include page context when provided', () => {
      const result = generatePrompt('Black Holes', baseSettings, 2, 5);
      expect(result.textPrompt).toContain('This is page 2 of 5');
    });

    it('should include semantic consistency instruction when previous content provided', () => {
      const previousContent = 'Black holes are regions of space where gravity is so strong...';
      const result = generatePrompt('Black Holes', baseSettings, 2, 5, previousContent);
      
      expect(result.textPrompt).toContain('Build on the previous page');
      expect(result.textPrompt).toContain(previousContent);
    });

    it('should respect word limits for different levels', () => {
      const toddlerSettings: BookSettings = { ...baseSettings, level: 'Toddler' };
      const expertSettings: BookSettings = { ...baseSettings, level: 'Expert' };

      const toddlerResult = generatePrompt('Black Holes', toddlerSettings);
      const expertResult = generatePrompt('Black Holes', expertSettings);

      expect(toddlerResult.textPrompt).toContain('60 words');
      expect(expertResult.textPrompt).toContain('150 words');
    });
  });

  describe('generateImagePrompt', () => {
    it('should generate positive and negative prompts', () => {
      const result = generateImagePrompt('Black Holes', 0.5, 1);
      
      expect(result.positive).toBeDefined();
      expect(result.negative).toBeDefined();
      expect(result.positive).toContain('Black Holes');
      expect(result.positive).toContain('page 1');
    });

    it('should map style values to correct visual categories', () => {
      const cartoonishResult = generateImagePrompt('Black Holes', 0.2);
      const balancedResult = generateImagePrompt('Black Holes', 0.5);
      const realisticResult = generateImagePrompt('Black Holes', 0.9);

      expect(cartoonishResult.positive).toContain('watercolor');
      expect(cartoonishResult.positive).toContain('hand-drawn');
      expect(balancedResult.positive).toContain('digital art');
      expect(realisticResult.positive).toContain('photography');
      expect(realisticResult.positive).toContain('hyper-realistic');
    });

    it('should include appropriate negative prompts for each style', () => {
      const cartoonishResult = generateImagePrompt('Black Holes', 0.2);
      const realisticResult = generateImagePrompt('Black Holes', 0.9);

      expect(cartoonishResult.negative).toContain('photorealistic');
      expect(cartoonishResult.negative).toContain('3d render');
      expect(realisticResult.negative).toContain('cartoon');
      expect(realisticResult.negative).toContain('illustration');
    });
  });

  describe('generateQuipPrompt', () => {
    it('should generate a quip prompt with content and subject', () => {
      const content = 'Black holes have such strong gravity that not even light can escape.';
      const result = generateQuipPrompt(content, 'Black Holes');
      
      expect(result).toContain('Logic the Lemur');
      expect(result).toContain('Black Holes');
      expect(result).toContain(content);
      expect(result).toContain('15 words');
    });
  });

  describe('generateNegativePrompt', () => {
    it('should return appropriate negative prompt for style value', () => {
      const cartoonishNegative = generateNegativePrompt(0.2);
      const balancedNegative = generateNegativePrompt(0.5);
      const realisticNegative = generateNegativePrompt(0.9);

      expect(cartoonishNegative).toContain('photorealistic');
      expect(balancedNegative).toContain('blurry');
      expect(realisticNegative).toContain('cartoon');
    });
  });

  describe('getStyleDescription', () => {
    it('should return correct style descriptions', () => {
      const cartoonishDesc = getStyleDescription(0.2);
      const balancedDesc = getStyleDescription(0.5);
      const realisticDesc = getStyleDescription(0.9);

      expect(cartoonishDesc.label).toBe('Cartoonish');
      expect(cartoonishDesc.description).toContain('Watercolor');
      expect(balancedDesc.label).toBe('Digital Art');
      expect(balancedDesc.description).toContain('educational');
      expect(realisticDesc.label).toBe('Realistic');
      expect(realisticDesc.description).toContain('Photographic');
    });
  });

  describe('LEVEL_SPECS', () => {
    it('should have correct specifications for each level', () => {
      expect(LEVEL_SPECS).toBeDefined();
      expect(LEVEL_SPECS.Toddler).toBeDefined();
      expect(LEVEL_SPECS.Student).toBeDefined();
      expect(LEVEL_SPECS.Expert).toBeDefined();

      expect(LEVEL_SPECS.Toddler.wordLimit).toBe(60);
      expect(LEVEL_SPECS.Student.wordLimit).toBe(100);
      expect(LEVEL_SPECS.Expert.wordLimit).toBe(150);
    });

    it('should have appropriate audience descriptions', () => {
      expect(LEVEL_SPECS.Toddler.audience).toContain('ages 3-5');
      expect(LEVEL_SPECS.Student.audience).toContain('ages 11-14');
      expect(LEVEL_SPECS.Expert.audience).toContain('academic');
    });
  });

  describe('VISUAL_STYLES', () => {
    it('should have style descriptors for all categories', () => {
      expect(VISUAL_STYLES).toBeDefined();
      expect(VISUAL_STYLES.cartoonish).toBeDefined();
      expect(VISUAL_STYLES.balanced).toBeDefined();
      expect(VISUAL_STYLES.realistic).toBeDefined();

      expect(VISUAL_STYLES.cartoonish.positive).toContain('watercolor');
      expect(VISUAL_STYLES.balanced.positive).toContain('digital art');
      expect(VISUAL_STYLES.realistic.positive).toContain('photography');
    });

    it('should have both positive and negative prompts', () => {
      expect(VISUAL_STYLES).toBeDefined();
      for (const style of Object.values(VISUAL_STYLES)) {
        expect(style.positive).toBeDefined();
        expect(style.negative).toBeDefined();
        expect(style.positive.length).toBeGreaterThan(0);
        expect(style.negative.length).toBeGreaterThan(0);
      }
    });
  });
});
