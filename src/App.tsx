import React, { useState, useCallback } from 'react';
import { Scene, OcrResult, OcrRow, AppPage } from './types';
import { SceneManager } from './components/SceneManager';
import { SceneEditor } from './components/SceneEditor';
import { ImageUploader } from './components/ImageUploader';
import { ResultPreview } from './components/ResultPreview';
import { Settings } from './components/Settings';
import { getSettings } from './stores/scene-store';
import { recognizeImage, fileToBase64, urlToBase64, buildPrompt } from './services/qwen-vl';
import {
  ensureFields,
  insertRecords,
  upsertRecords,
  getTableList,
  getTableFields,
  getRecordImages,
  getRecordsWithImages,
  ensureStatusField,
  markRecordsRecognized,
} from './services/bitable';
import './App.css';

const App: React.FC = () => {
  // 页面路由
  const [page, setPage] = useState<AppPage>('home');

  // 当前选中的场景
  const [currentScene, setCurrentScene] = useState<Scene | null>(null);
  const [editingScene, setEditingScene] = useState<Scene | undefined>(undefined);

  // 图片相关
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // OCR 状态
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 写入状态
  const [inserting, setInserting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 表格选择
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [tableFields, setTableFields] = useState<{ id: string; name: string; isAttachment: boolean }[]>([]);

  // 批量处理模式
  const [batchMode, setBatchMode] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // 提示词预览
  const [showPrompt, setShowPrompt] = useState(false);

  /** 选择场景 */
  const handleSelectScene = useCallback(async (scene: Scene) => {
    setCurrentScene(scene);
    setOcrResult(null);
    setError(null);
    setSuccessMsg(null);
    setBatchMode(false);
    setPage('home');

    // 加载表格列表
    try {
      const list = await getTableList();
      setTables(list);

      // 如果场景有目标表格，自动选择
      if (scene.targetTableId) {
        setSelectedTableId(scene.targetTableId);
        // 加载表格字段
        try {
          const fields = await getTableFields(scene.targetTableId);
          setTableFields(fields.map((f) => ({ id: f.id, name: f.name, isAttachment: f.isAttachment || false })));
        } catch {
          setTableFields([]);
        }
      } else if (list.length > 0 && !selectedTableId) {
        setSelectedTableId(list[0].id);
        // 加载第一个表格的字段
        try {
          const fields = await getTableFields(list[0].id);
          setTableFields(fields.map((f) => ({ id: f.id, name: f.name, isAttachment: f.isAttachment || false })));
        } catch {
          setTableFields([]);
        }
      }
    } catch {
      // 不在飞书环境中可能获取失败
    }
  }, [selectedTableId]);

  /** 选择图片 */
  const handleImageSelect = useCallback((file: File, preview: string) => {
    setImageFile(file);
    setImagePreview(preview);
    setOcrResult(null);
    setError(null);
    setSuccessMsg(null);
    setBatchMode(false);
  }, []);

  /** 清除图片 */
  const handleClearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    setOcrResult(null);
    setError(null);
    setSuccessMsg(null);
    setBatchMode(false);
  }, []);

  /** 执行 OCR */
  const handleRecognize = useCallback(async () => {
    if (!currentScene || !imageFile) return;

    const settings = getSettings();
    if (!settings.apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setLoading(true);
    setError(null);
    setOcrResult(null);
    setSuccessMsg(null);
    setBatchMode(false);

    try {
      const base64 = await fileToBase64(imageFile);
      const result = await recognizeImage(settings, currentScene, base64);
      setOcrResult(result);
    } catch (err: any) {
      setError(err.message || '识别失败，请检查网络和 API Key');
    } finally {
      setLoading(false);
    }
  }, [currentScene, imageFile]);

  /** 批量处理表格中的图片 */
  const handleBatchProcess = useCallback(async () => {
    if (!currentScene || !currentScene.imageColumnId || !selectedTableId) {
      setError('请先配置图片列和目标表格');
      return;
    }

    const settings = getSettings();
    if (!settings.apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setIsBatchProcessing(true);
    setBatchMode(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // 1. 确保"识别状态"字段存在
      const statusFieldId = await ensureStatusField(selectedTableId);

      // 2. 批量扫描所有记录，筛选有附件且未识别的记录
      console.log(`[BatchProcess] imageColumnId=${currentScene.imageColumnId}, selectedTableId=${selectedTableId}`);
      const recordsWithImages = await getRecordsWithImages(currentScene.imageColumnId!, selectedTableId, statusFieldId);
      console.log(`[BatchProcess] 找到 ${recordsWithImages.length} 条需要识别的记录`);

      if (recordsWithImages.length === 0) {
        setSuccessMsg('所有带图片的记录已经识别过了，无需重复处理。');
        setIsBatchProcessing(false);
        return;
      }

      // 3. 批量识别（每行的所有附件都识别）
      const totalImages = recordsWithImages.reduce((sum, r) => sum + r.urls.length, 0);
      setBatchProgress({ current: 0, total: totalImages, success: 0, failed: 0 });

      const allResults: { recordId: string; rows: OcrRow[] }[] = [];
      const processedRecordIds: string[] = [];
      let imageIndex = 0;

      for (const { recordId, urls } of recordsWithImages) {
        for (const imageUrl of urls) {
          imageIndex++;
          setBatchProgress((prev) => ({ ...prev, current: imageIndex }));

          try {
            console.log(`[BatchProcess] 处理第 ${imageIndex}/${totalImages} 张图片:`, imageUrl);

            // 对于飞书附件URL，直接传给百炼让服务器下载
            // 对于其他URL，尝试下载转为base64
            let imageData: string;
            if (imageUrl.includes('feishu.cn') || imageUrl.includes('larksuite.com')) {
              console.log('[BatchProcess] 使用飞书URL直接识别');
              imageData = imageUrl;
            } else {
              console.log('[BatchProcess] 下载图片转为base64');
              imageData = await urlToBase64(imageUrl);
            }

            const result = await recognizeImage(settings, currentScene, imageData);
            allResults.push({ recordId, rows: result.rows });
            if (!processedRecordIds.includes(recordId)) {
              processedRecordIds.push(recordId);
            }
            setBatchProgress((prev) => ({ ...prev, success: prev.success + 1 }));
          } catch (err: any) {
            console.error(`[BatchProcess] 处理第 ${imageIndex} 张图片失败:`, err);
            setBatchProgress((prev) => ({ ...prev, failed: prev.failed + 1 }));
          }
        }
      }

      // 4. 写入结果到表格
      if (allResults.length > 0) {
        const fieldMap = await ensureFields(currentScene, selectedTableId);

        // 合并所有识别结果
        const allRows: OcrRow[] = [];
        for (const { rows } of allResults) {
          allRows.push(...rows);
        }

        // 使用 upsert 写入
        const { updated, inserted } = await upsertRecords(allRows, fieldMap, currentScene, selectedTableId);

        // 5. 标记已成功识别的记录
        await markRecordsRecognized(processedRecordIds, statusFieldId, selectedTableId);

        setSuccessMsg(
          `批量处理完成！成功识别 ${allResults.length}/${recordsWithImages.length} 条记录，` +
          `写入 ${allRows.length} 条数据（更新 ${updated} 条，新增 ${inserted} 条）`
        );
      } else {
        setError('没有成功识别任何图片');
      }
    } catch (err: any) {
      setError(err.message || '批量处理失败');
    } finally {
      setIsBatchProcessing(false);
    }
  }, [currentScene, selectedTableId]);

  /** 写入多维表格 */
  const handleInsert = useCallback(
    async (rows: OcrRow[]) => {
      if (!currentScene || rows.length === 0) return;
      setInserting(true);
      setError(null);

      try {
        const fieldMap = await ensureFields(
          currentScene,
          selectedTableId || undefined
        );

        // 如果有唯一字段，使用 upsert
        if (currentScene.uniqueFields && currentScene.uniqueFields.length > 0) {
          const { updated, inserted } = await upsertRecords(
            rows,
            fieldMap,
            currentScene,
            selectedTableId || undefined
          );
          setSuccessMsg(`已成功写入 ${rows.length} 条记录到多维表格！（更新 ${updated} 条，新增 ${inserted} 条）`);
        } else {
          await insertRecords(rows, fieldMap, currentScene, selectedTableId || undefined);
          setSuccessMsg(`已成功写入 ${rows.length} 条记录到多维表格！`);
        }
      } catch (err: any) {
        setError(err.message || '写入失败');
      } finally {
        setInserting(false);
      }
    },
    [currentScene, selectedTableId]
  );

  /** 渲染导航栏 */
  const renderNav = () => (
    <nav className="app-nav">
      <div className="app-nav-brand" onClick={() => setPage('home')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Onyx OCR</span>
      </div>
      <div className="app-nav-actions">
        <button
          className={`nav-btn ${page === 'scenes' ? 'active' : ''}`}
          onClick={() => setPage('scenes')}
          title="场景管理"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>
        <button
          className={`nav-btn ${page === 'settings' ? 'active' : ''}`}
          onClick={() => setPage('settings')}
          title="设置"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </nav>
  );

  /** 渲染主工作区 */
  const renderWorkspace = () => {
    if (!currentScene) return null;

    const hasImageColumn = !!currentScene.imageColumnId;
    const hasUniqueFields = currentScene.uniqueFields && currentScene.uniqueFields.length > 0;

    return (
      <div className="workspace">
        {/* 场景信息栏 */}
        <div className="scene-info-bar">
          <div className="scene-info">
            <span className="scene-badge">{currentScene.name}</span>
            <span className="scene-field-count">{currentScene.fields.filter(f => f.enabled !== false).length} 个字段</span>
            {hasUniqueFields && (
              <span className="scene-unique-fields">
                唯一字段: {currentScene.uniqueFields!.join(', ')}
              </span>
            )}
          </div>
          <div className="scene-info-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowPrompt(!showPrompt)}
            >
              {showPrompt ? '隐藏提示词' : '查看提示词'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPage('scenes')}
            >
              切换场景
            </button>
          </div>
        </div>

        {showPrompt && (
          <pre className="prompt-preview">{buildPrompt(currentScene)}</pre>
        )}

        {/* 表格选择 */}
        {tables.length > 0 && (
          <div className="form-group compact">
            <label className="form-label">目标数据表</label>
            <select
              className="form-select"
              value={selectedTableId}
              onChange={(e) => {
                setSelectedTableId(e.target.value);
                // 加载新表格的字段
                if (e.target.value) {
                  getTableFields(e.target.value).then((fields) => {
                    setTableFields(fields.map((f) => ({ id: f.id, name: f.name, isAttachment: f.isAttachment || false })));
                  }).catch(() => {
                    setTableFields([]);
                  });
                }
              }}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 批量处理按钮（如果配置了图片列） */}
        {hasImageColumn && selectedTableId && (
          <div className="form-group compact batch-mode-section">
            <div className="batch-mode-info">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>已配置图片列：{currentScene.imageColumnName || '图片'}</span>
            </div>
            <button
              className="btn btn-secondary"
              onClick={handleBatchProcess}
              disabled={isBatchProcessing}
            >
              {isBatchProcessing ? (
                <span className="loading-text">
                  <span className="spinner" />
                  批量处理中... {batchProgress.current}/{batchProgress.total}
                </span>
              ) : (
                '批量识别表格图片'
              )}
            </button>
          </div>
        )}

        {/* 批量处理进度 */}
        {isBatchProcessing && (
          <div className="batch-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
            <div className="progress-stats">
              <span>处理中: {batchProgress.current}/{batchProgress.total}</span>
              <span className="success">成功: {batchProgress.success}</span>
              <span className="failed">失败: {batchProgress.failed}</span>
            </div>
          </div>
        )}

        {/* 图片上传（手动模式） */}
        {!isBatchProcessing && (
          <ImageUploader
            onImageSelect={handleImageSelect}
            imagePreview={imagePreview}
            onClear={handleClearImage}
          />
        )}

        {/* 操作按钮 */}
        {imageFile && !ocrResult && !isBatchProcessing && (
          <div className="action-bar">
            <button
              className="btn btn-primary btn-block"
              onClick={handleRecognize}
              disabled={loading}
            >
              {loading ? (
                <span className="loading-text">
                  <span className="spinner" />
                  识别中...
                </span>
              ) : (
                '开始识别'
              )}
            </button>
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="message message-error">
            {error}
          </div>
        )}

        {/* 成功信息 */}
        {successMsg && (
          <div className="message message-success">
            {successMsg}
          </div>
        )}

        {/* 识别结果 */}
        {ocrResult && currentScene && !isBatchProcessing && (
          <ResultPreview
            scene={currentScene}
            result={ocrResult}
            onConfirm={handleInsert}
            onRetry={handleRecognize}
            inserting={inserting}
          />
        )}
      </div>
    );
  };

  return (
    <div className="app">
      {renderNav()}
      <main className="app-content">
        {page === 'settings' && <Settings onBack={() => setPage(currentScene ? 'home' : 'scenes')} />}
        {page === 'scenes' && (
          <SceneManager
            onSelect={handleSelectScene}
            onEdit={(scene) => {
              setEditingScene(scene);
              setPage('scene-edit');
            }}
            onCreate={() => {
              setEditingScene(undefined);
              setPage('scene-edit');
            }}
          />
        )}
        {page === 'scene-edit' && (
          <SceneEditor
            scene={editingScene}
            onSave={() => setPage('scenes')}
            onCancel={() => setPage('scenes')}
          />
        )}
        {page === 'home' && !currentScene && (
          <SceneManager
            onSelect={handleSelectScene}
            onEdit={(scene) => {
              setEditingScene(scene);
              setPage('scene-edit');
            }}
            onCreate={() => {
              setEditingScene(undefined);
              setPage('scene-edit');
            }}
          />
        )}
        {page === 'home' && currentScene && renderWorkspace()}
      </main>
    </div>
  );
};

export default App;
