export const validateResumeFile = (file: File | null): { valid: boolean; error?: string } => {
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size is 5MB.' };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { valid: false, error: 'Please upload a PDF or DOCX file.' };
  }

  return { valid: true };
};

export const formatFileSize = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1) + ' MB';
};

export const getFileExtension = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() || '';
};
