import React, { useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { useModelState, ModelStatus } from '../contexts/ModelContext';
import type { BookSettings } from '../types';
import './ControlPanel.css';

interface ControlPanelProps {
  settings: BookSettings;
  setSettings: (settings: BookSettings) => void;
  onGenerate: () => void;
  onCancel: () => void;
  loading: boolean;
}

/**
 * Enhanced ControlPanel with model state validation and debounced live updates
 */
const ControlPanel: React.FC<ControlPanelProps> = ({ 
  settings, 
  setSettings, 
  onGenerate, 
  onCancel, 
  loading 
}) => {
  const { textModel, imageModel, isWebGPUSupported } = useModelState();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasGeneratedRef = useRef(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings({
      ...settings,
      [name]: name === 'level' ? value : name === 'numPages' ? parseInt(value, 10) : parseFloat(value)
    });
  };

  const handleSliderKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    name: keyof BookSettings,
    currentValue: number
  ) => {
    // Use integer steps for numPages, float steps for others
    const step = name === 'numPages' ? 1 : 0.1;
    const maxVal = name === 'numPages' ? 5 : 1;
    const minVal = name === 'numPages' ? 1 : 0;
    let newValue = currentValue;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newValue = Math.min(maxVal, currentValue + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newValue = Math.max(minVal, currentValue - step);
        break;
      case 'Home':
        e.preventDefault();
        newValue = minVal;
        break;
      case 'End':
        e.preventDefault();
        newValue = maxVal;
        break;
      default:
        return;
    }

    setSettings({
      ...settings,
      [name]: name === 'numPages' ? Math.round(newValue) : parseFloat(newValue.toFixed(1))
    });
  };

  // Debounced live update for text regeneration (not images to save GPU)
  useEffect(() => {
    // Only trigger after initial generation and if subject exists
    if (!hasGeneratedRef.current || !settings.subject) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      // Trigger a text-only regeneration (future enhancement)
      console.log('Live update triggered (text-only regeneration would happen here)');
    }, 1000);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.tone, settings.style, settings.complexity, settings.level]);

  // Track when generation has occurred
  useEffect(() => {
    if (loading) {
      hasGeneratedRef.current = true;
    }
  }, [loading]);

  // Determine if generation should be blocked
  const isModelsLoading = textModel.status === ModelStatus.LOADING ||
                          imageModel.status === ModelStatus.LOADING;
  const hasModelError = textModel.status === ModelStatus.ERROR ||
                        imageModel.status === ModelStatus.ERROR;
  const isWebGPURequiredButMissing = !isWebGPUSupported && imageModel.status !== ModelStatus.READY;

  // Block generation if:
  // - Models are currently loading
  // - There's a model error
  // - WebGPU is required but not available (and image model isn't already loaded)
  const isGenerationBlocked = isModelsLoading || hasModelError || isWebGPURequiredButMissing;

  const getDisabledReason = (): string | null => {
    if (isModelsLoading) return 'Models are loading...';
    if (textModel.status === ModelStatus.ERROR) return 'Text model error';
    if (imageModel.status === ModelStatus.ERROR) return 'Image model error';
    if (!isWebGPUSupported && imageModel.status !== ModelStatus.READY) {
      return 'WebGPU not supported';
    }
    if (!settings.subject) return 'Enter a subject';
    return null;
  };

  const disabledReason = getDisabledReason();
  const isDisabled = isGenerationBlocked || !settings.subject || loading;

  return (
    <div className="control-panel">
      <div className="input-group">
        <label>What do you want to learn about?</label>
        <input
          type="text"
          name="subject"
          placeholder="e.g., How black holes work"
          value={settings.subject}
          onChange={(e) => setSettings({ ...settings, subject: e.target.value })}
          className="subject-input"
        />
      </div>

      <div className="slider-group">
        <div className="slider-item">
          <label id="tone-label">Tone: {settings.tone > 0.7 ? "Fun" : settings.tone < 0.3 ? "Academic" : "Balanced"}</label>
          <input
            type="range"
            name="tone"
            min="0"
            max="1"
            step="0.1"
            value={settings.tone}
            onChange={handleChange}
            onKeyDown={(e) => handleSliderKeyDown(e, 'tone', settings.tone)}
            aria-labelledby="tone-label"
            aria-valuetext={settings.tone > 0.7 ? "Fun" : settings.tone < 0.3 ? "Academic" : "Balanced"}
          />
        </div>

        <div className="slider-item">
          <label id="style-label">Visual Style: {settings.style > 0.7 ? "Realistic" : settings.style < 0.3 ? "Cartoonish" : "Digital Art"}</label>
          <input
            type="range"
            name="style"
            min="0"
            max="1"
            step="0.1"
            value={settings.style}
            onChange={handleChange}
            onKeyDown={(e) => handleSliderKeyDown(e, 'style', settings.style)}
            aria-labelledby="style-label"
            aria-valuetext={settings.style > 0.7 ? "Realistic" : settings.style < 0.3 ? "Cartoonish" : "Digital Art"}
          />
        </div>

        <div className="slider-item">
          <label id="complexity-label">Complexity: {settings.complexity > 0.7 ? "Deep" : settings.complexity < 0.3 ? "Simple" : "Medium"}</label>
          <input
            type="range"
            name="complexity"
            min="0"
            max="1"
            step="0.1"
            value={settings.complexity}
            onChange={handleChange}
            onKeyDown={(e) => handleSliderKeyDown(e, 'complexity', settings.complexity)}
            aria-labelledby="complexity-label"
            aria-valuetext={settings.complexity > 0.7 ? "Deep" : settings.complexity < 0.3 ? "Simple" : "Medium"}
          />
        </div>

        <div className="slider-item">
          <label id="pages-label">Number of Pages: {settings.numPages || 3}</label>
          <input
            type="range"
            name="numPages"
            min="1"
            max="5"
            step="1"
            value={settings.numPages || 3}
            onChange={handleChange}
            onKeyDown={(e) => handleSliderKeyDown(e, 'numPages', settings.numPages || 3)}
            aria-labelledby="pages-label"
            aria-valuetext={`${settings.numPages || 3} pages`}
          />
        </div>
      </div>

      <div className="input-group">
        <label>Reading Level</label>
        <select name="level" value={settings.level} onChange={handleChange}>
          <option value="Toddler">Toddler</option>
          <option value="Student">Student</option>
          <option value="Expert">Expert</option>
        </select>
      </div>

      {/* Pre-generation Storage Warning */}
      {(textModel.status === ModelStatus.IDLE || textModel.status === ModelStatus.UNLOADED) && (
        <div className="status-warning info">
          <span className="warning-icon">ℹ️</span>
          <span>First generation will download AI models (~1.5GB). This runs entirely locally on your device.</span>
        </div>
      )}

      {/* Model Status Warnings */}
      {isModelsLoading && (
        <div className="status-warning loading">
          <span className="warning-icon">⏳</span>
          <span>Models are initializing. Please wait...</span>
        </div>
      )}

      {hasModelError && (
        <div className="status-warning error">
          <span className="warning-icon">⚠️</span>
          <span>Model error occurred. Try reloading the page.</span>
        </div>
      )}

      {!isWebGPUSupported && imageModel.status !== ModelStatus.READY && (
        <div className="status-warning warning">
          <span className="warning-icon">⚡</span>
          <span>WebGPU not supported. Image generation may not work.</span>
        </div>
      )}

      <div className="control-panel-actions">
        {loading && (
          <button
            onClick={onCancel}
            className="cancel-btn"
            aria-label="Cancel generation"
          >
            ❌ Cancel
          </button>
        )}
        <button
          onClick={onGenerate}
          disabled={isDisabled}
          className="generate-btn"
          title={disabledReason ?? undefined}
        >
          {loading ? "Generating..." : disabledReason ? `${disabledReason}` : "Generate Book"}
        </button>
      </div>
    </div>
  );
};

export default ControlPanel;
