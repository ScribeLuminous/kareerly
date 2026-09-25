const RESUME_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword'],
};

export const validateResumeFile = (file: File | null): { valid: boolean; error?: string } => {
  if (!file) {
    return { valid: false, error: 'No file selected' };
  }

  const MAX_SIZE = 5 * 1024 * 1024; // 5MB, the backend limit
  const extension = getFileExtension(file.name);

  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size is 5MB.' };
  }

  // Browsers report no type (or a generic one) for .doc files on some systems,
  // so the extension decides; the server checks the file's contents.
  const allowedTypes = RESUME_TYPES[extension];
  if (!allowedTypes || (file.type && file.type !== 'application/octet-stream' && !allowedTypes.includes(file.type))) {
    return { valid: false, error: 'Please upload a PDF, DOCX or DOC file.' };
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
