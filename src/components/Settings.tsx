import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { getSettings, saveSettings } from '../stores/scene-store';

interface Props {
  onBack: () => void;
}

const MODEL_OPTIONS = [
  { value: 'qwen-vl-max', label: 'Qwen2.5-VL-Max（效果最佳）' },
  { value: 'qwen-vl-plus', label: 'Qwen2.5-VL-Plus（均衡）' },
  { value: 'qwen3-vl-plus', label: 'Qwen3-VL-Plus（最新最强）' },
  { value: 'qwen3-vl-flash', label: 'Qwen3-VL-Flash（快速低价）' },
];

export const Settings: React.FC<Props> = ({ onBack }) => {
  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    if (!settings.apiKey.trim()) {
      alert('请输入 API Key');
      return;
    }
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-page">
      <div className="section-header">
        <h3>设置</h3>
      </div>

      <div className="form-group">
        <label className="form-label">百炼 API Key *</label>
        <div className="input-with-action">
          <input
            className="form-input"
            type={showKey ? 'text' : 'password'}
            value={settings.apiKey}
            onChange={(e) =>
              setSettings((s) => ({ ...s, apiKey: e.target.value }))
            }
            placeholder="sk-xxxxxxxxxxxxxxxx"
          />
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <div className="form-hint">
          在{' '}
          <a
            href="https://bailian.console.aliyun.com/#/api-key"
            target="_blank"
            rel="noopener"
          >
            阿里云百炼控制台
          </a>{' '}
          获取 API Key
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">模型</label>
        <select
          className="form-select"
          value={settings.model}
          onChange={(e) =>
            setSettings((s) => ({ ...s, model: e.target.value }))
          }
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">API Base URL</label>
        <input
          className="form-input"
          value={settings.baseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, baseUrl: e.target.value }))
          }
          placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
        />
      </div>

      <div className="form-actions">
        <button className="btn btn-default" onClick={onBack}>
          返回
        </button>
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '已保存' : '保存设置'}
        </button>
      </div>
    </div>
  );
};
