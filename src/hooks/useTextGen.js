import { useModel, ModelStatus } from '../contexts/ModelContext';

/**
 * Hook for text generation - wraps ModelContext for backward compatibility
 * @deprecated Use useModel directly for new code
 */
export const useTextGen = () => {
  const {
    generateText,
    textModel,
    initTextModel,
    unloadTextModel,
  } = useModel();

  return {
    generateText,
    loading: textModel.loading,
    progress: textModel.progress,
    status: textModel.status,
    error: textModel.error,
    device: textModel.device,
    initGenerator: initTextModel,
    unloadModel: unloadTextModel,
    modelStatus: textModel.status,
  };
};

export default useTextGen;
