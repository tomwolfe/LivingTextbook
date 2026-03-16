import React from 'react';
import { useModel, ModelStatus } from '../contexts/ModelContext';
import { Cpu, Zap, AlertCircle, CheckCircle, Loader2, MemoryStick } from 'lucide-react';
import './ModelStatusDashboard.css';

/**
 * ModelStatusDashboard - Displays AI model status and WebGPU capabilities
 */
const ModelStatusDashboard = ({ collapsed = false }) => {
  const {
    textModel,
    imageModel,
    webgpuCapabilities,
    isWebGPUSupported,
  } = useModel();

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
          <span>Text Generation (SmolLM2)</span>
        </div>
        <div className={`model-status ${getStatusClass(textModel.status)}`}>
          {getStatusIcon(textModel.status)}
          <span className="status-text">{textModel.status}</span>
        </div>
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
