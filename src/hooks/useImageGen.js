import { useModel, ModelStatus } from '../contexts/ModelContext';

/**
 * Hook for image generation - wraps ModelContext for backward compatibility
 * @deprecated Use useModel directly for new code
 */
export const useImageGen = () => {
  const {
    generateImage,
    imageModel,
    initImageModel,
    unloadImageModel,
    webgpuCapabilities,
    isWebGPUSupported,
  } = useModel();

  return {
    generateImage,
    loading: imageModel.loading,
    status: imageModel.status,
    error: imageModel.error,
    progress: imageModel.progress,
    device: imageModel.device,
    initModel: initImageModel,
    unloadModel: unloadImageModel,
    webgpuSupported: isWebGPUSupported,
    webgpuCapabilities,
  };
};

export default useImageGen;
