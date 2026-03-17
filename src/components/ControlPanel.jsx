import React, { useEffect, useRef } from 'react';
import { useModelState, ModelStatus } from '../contexts/ModelContext';
import './ControlPanel.css';

/**
 * Enhanced ControlPanel with model state validation and debounced live updates
 */
const ControlPanel = ({ settings, setSettings, onGenerate, loading }) => {
  const { textModel, imageModel, isWebGPUSupported } = useModelState();
  const debounceRef = useRef(null);
  const hasGeneratedRef = useRef(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: name === 'level' ? value : parseFloat(value)
    }));
  };

  const handleSliderKeyDown = (e, name, currentValue) => {
    const step = 0.1;
    let newValue = currentValue;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        newValue = Math.min(1, currentValue + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        newValue = Math.max(0, currentValue - step);
        break;
      case 'Home':
        e.preventDefault();
        newValue = 0;
        break;
      case 'End':
        e.preventDefault();
        newValue = 1;
        break;
      default:
        return;
    }

    setSettings(prev => ({
      ...prev,
      [name]: parseFloat(newValue.toFixed(1))
    }));
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

  const getDisabledReason = () => {
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
          onChange={(e) => setSettings(prev => ({ ...prev, subject: e.target.value }))}
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
      </div>

      <div className="input-group">
        <label>Reading Level</label>
        <select name="level" value={settings.level} onChange={handleChange}>
          <option value="Toddler">Toddler</option>
          <option value="Student">Student</option>
          <option value="Expert">Expert</option>
        </select>
      </div>

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

      <button
        onClick={onGenerate}
        disabled={isDisabled}
        className="generate-btn"
        title={disabledReason}
      >
        {loading ? "Generating..." : disabledReason ? `${disabledReason}` : "Generate Book"}
      </button>
    </div>
  );
};

export default ControlPanel;
