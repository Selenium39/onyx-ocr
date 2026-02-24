import React, { useRef, useState, useCallback } from 'react';

interface Props {
  onImageSelect: (file: File, preview: string) => void;
  imagePreview: string | null;
  onClear: () => void;
}

export const ImageUploader: React.FC<Props> = ({
  onImageSelect,
  imagePreview,
  onClear,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        alert('请上传图片文件');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        onImageSelect(file, e.target?.result as string);
      };
      reader.readAsDataURL(file);
    },
    [onImageSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) handleFile(file);
          break;
        }
      }
    },
    [handleFile]
  );

  return (
    <div className="image-uploader" onPaste={handlePaste} tabIndex={0}>
      {imagePreview ? (
        <div className="image-preview-container">
          <img src={imagePreview} alt="预览" className="image-preview" />
          <button className="btn btn-danger btn-sm image-clear" onClick={onClear}>
            移除图片
          </button>
        </div>
      ) : (
        <div
          className={`upload-zone ${isDragging ? 'dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
        >
          <div className="upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="upload-text">
            <p>点击上传、拖拽或粘贴图片</p>
            <p className="upload-hint">支持 JPG、PNG、BMP 等常见格式</p>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};
