import React from 'react';
import { useModelActions, useModelState, ModelStatus } from '../contexts/ModelContext';
import { Cpu, Zap, AlertCircle, CheckCircle, Loader2, MemoryStick, Gauge, ToggleLeft } from 'lucide-react';
import './ModelStatusDashboard.css';

/**
 * ModelStatusDashboard - Displays AI model status and WebGPU capabilities
 */
const ModelStatusDashboard = ({ collapsed = false }) => {
  const actions = useModelActions();
  const state = useModelState();
  
  const {
    textModel,
    qualityTextModel,
    activeTextModel,
    imageModel,
    webgpuCapabilities,
    isWebGPUSupported,
    speedMode,
    toggleSpeedMode,
    deviceResources,
  } = state;

  const { fetchCacheStats, clearImageCache } = actions;

  const [cacheStats, setCacheStats] = React.useState({ imageCount: 0, estimatedSize: 'Unknown' });

  React.useEffect(() => {
    fetchCacheStats().then(setCacheStats);
  }, [fetchCacheStats]);

  const handleClearCache = React.useCallback(async () => {
    if (confirm('Clear all cached images? This will not delete your generated books.')) {
      await clearImageCache();
      const newStats = await fetchCacheStats();
      setCacheStats(newStats);
    }
  }, [clearImageCache, fetchCacheStats]);

  if (collapsed) {
    return (
      <div className="model-status-mini">
        <div className={`status-indicator ${textModel.status === ModelStatus.READY ? 'ready' : textModel.status === ModelStatus.ERROR ? 'error' : 'loading'}`} />
        <div className={`status-indicator ${imageModel.status === ModelStatus.READY ? 'ready' : imageModel.status === ModelStatus.ERROR ? 'error' : 'loading'}`} />
      </div>
    );
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case ModelStatus.READY:
        return <CheckCircle className="icon-success" size={18} />;
      case ModelStatus.LOADING:
        return <Loader2 className="icon-loading" size={18} />;
      case ModelStatus.ERROR:
        return <AlertCircle className="icon-error" size={18} />;
      default:
        return <Cpu size={18} />;
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case ModelStatus.READY:
        return 'status-ready';
      case ModelStatus.LOADING:
        return 'status-loading';
      case ModelStatus.ERROR:
        return 'status-error';
      default:
        return 'status-idle';
    }
  };

  return (
    <div className="model-status-dashboard">
      <h3 className="dashboard-title">🤖 AI Model Status</h3>

      {/* Speed Mode Toggle */}
      <div className="speed-mode-section">
        <div className="speed-mode-header">
          <div className="capability-header">
            <Gauge size={16} />
            <span>Speed Mode</span>
          </div>
          <button
            className={`speed-mode-toggle ${speedMode ? 'active' : ''}`}
            onClick={() => toggleSpeedMode(!speedMode)}
            title={speedMode ? 'Disable Speed Mode' : 'Enable Speed Mode'}
          >
            <ToggleLeft size={20} />
          </button>
        </div>
        <div className="speed-mode-description">
          {speedMode 
            ? '🚀 Reduced quality for faster generation'
            : '✨ Full quality mode'}
        </div>
        {deviceResources && deviceResources.limitations.length > 0 && (
          <div className="speed-mode-reason">
            <AlertCircle size={12} />
            <span>
              {deviceResources.isLowMemory 
                ? 'Auto-enabled due to device constraints'
                : 'Manually enabled'}
            </span>
          </div>
        )}
      </div>

      {/* Image Cache Status */}
      <div className="cache-section">
        <div className="capability-header">
          <MemoryStick size={16} />
          <span>Image Cache</span>
        </div>
        <div className="cache-stats">
          <span className="cache-count">{cacheStats.imageCount} images</span>
          {cacheStats.imageCount > 0 && (
            <button className="cache-clear-btn" onClick={handleClearCache} title="Clear cached images">
              Clear Cache
            </button>
          )}
        </div>
        <div className="cache-description">
          Cached images load instantly on next use
        </div>
      </div>

      {/* WebGPU Capability Status */}
      <div className="capability-section">
        <div className="capability-header">
          <Zap size={16} />
          <span>WebGPU Status</span>
        </div>
        <div className={`webgpu-status ${isWebGPUSupported ? 'supported' : 'unsupported'}`}>
          {isWebGPUSupported ? (
            <>
              <CheckCircle size={14} />
              <span>WebGPU Available</span>
            </>
          ) : (
            <>
              <AlertCircle size={14} />
              <span>WebGPU Not Available</span>
            </>
          )}
        </div>
        {webgpuCapabilities && (
          <div className="capability-details">
            <div className="capability-item">
              <span>Shader F16:</span>
              <span className={webgpuCapabilities.shaderF16 ? 'yes' : 'no'}>
                {webgpuCapabilities.shaderF16 ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Text Model Status */}
      <div className="model-section">
        <div className="model-header">
          <Cpu size={16} />
          <span>Text Generation</span>
          <span className="active-model-badge">{activeTextModel === 'quality' ? 'Qwen2.5 (Quality)' : 'SmolLM2 (Fast)'}</span>
        </div>
        <div className={`model-status ${getStatusClass(textModel.status)}`}>
          {getStatusIcon(textModel.status)}
          <span className="status-text">Fast: {textModel.status}</span>
        </div>
        {qualityTextModel && qualityTextModel.status !== ModelStatus.IDLE && (
          <div className={`model-status ${getStatusClass(qualityTextModel.status)}`}>
            {getStatusIcon(qualityTextModel.status)}
            <span className="status-text">Quality: {qualityTextModel.status}</span>
          </div>
        )}
        {textModel.loading && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(textModel.progress, 100)}%` }}
            />
            <span className="progress-text">{textModel.progress}%</span>
          </div>
        )}
        {textModel.device && (
          <div className="device-info">
            <Cpu size={12} />
            <span>Device: {textModel.device}</span>
          </div>
        )}
        {textModel.error && (
          <div className="error-message">
            <AlertCircle size={12} />
            <span>{textModel.error}</span>
          </div>
        )}
      </div>

      {/* Image Model Status */}
      <div className="model-section">
        <div className="model-header">
          <MemoryStick size={16} />
          <span>Image Generation (SD-Turbo)</span>
        </div>
        <div className={`model-status ${getStatusClass(imageModel.status)}`}>
          {getStatusIcon(imageModel.status)}
          <span className="status-text">{imageModel.status}</span>
        </div>
        {imageModel.loading && (
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${Math.min(imageModel.progress, 100)}%` }}
            />
            <span className="progress-text">{imageModel.progress}%</span>
          </div>
        )}
        {imageModel.device && (
          <div className="device-info">
            <Zap size={12} />
            <span>Device: {imageModel.device}</span>
          </div>
        )}
        {imageModel.error && (
          <div className="error-message">
            <AlertCircle size={12} />
            <span>{imageModel.error}</span>
          </div>
        )}
        {!isWebGPUSupported && (
          <div className="warning-note">
            <AlertCircle size={12} />
            <span>Image generation requires WebGPU support</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelStatusDashboard;
