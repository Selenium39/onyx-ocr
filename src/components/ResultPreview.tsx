import React, { useState } from 'react';
import { Scene, OcrResult, OcrRow, SceneField } from '../types';
import { getEnabledFields } from '../stores/scene-store';

interface Props {
  scene: Scene;
  result: OcrResult;
  onConfirm: (rows: OcrRow[]) => void;
  onRetry: () => void;
  inserting: boolean;
}

/**
 * 递归扁平化字段列表，用于表格显示
 */
function flattenFields(fields: SceneField[], prefix = ''): Array<{ name: string; type: string }> {
  const result: Array<{ name: string; type: string }> = [];

  for (const field of fields) {
    const fieldName = prefix ? `${prefix}.${field.name}` : field.name;

    if (field.children && field.children.length > 0) {
      // 父字段 - 递归处理子字段
      result.push(...flattenFields(field.children, fieldName));
    } else {
      // 普通字段
      result.push({ name: fieldName, type: field.type });
    }
  }

  return result;
}

export const ResultPreview: React.FC<Props> = ({
  scene,
  result,
  onConfirm,
  onRetry,
  inserting,
}) => {
  const [editableRows, setEditableRows] = useState<OcrRow[]>(
    result.rows.map((row) => ({ ...row }))
  );
  const [showRaw, setShowRaw] = useState(false);

  const enabledFields = getEnabledFields(scene);
  // 扁平化字段列表用于显示（因为解析后的数据是扁平化的）
  const flattenedFields = flattenFields(enabledFields);
  const hasMultipleRows = editableRows.length > 1;

  const updateCell = (rowIndex: number, fieldName: string, value: string) => {
    setEditableRows((prev) => {
      const next = prev.map((row) => ({ ...row }));
      next[rowIndex][fieldName] = value;
      return next;
    });
  };

  const deleteRow = (rowIndex: number) => {
    setEditableRows((prev) => prev.filter((_, i) => i !== rowIndex));
  };

  return (
    <div className="result-preview">
      <div className="section-header">
        <h3>识别结果</h3>
        <span className="result-meta">
          {editableRows.length} 条记录 · 耗时 {(result.duration / 1000).toFixed(1)}s
        </span>
      </div>

      {/* 多行数据表格 */}
      {hasMultipleRows ? (
        <div className="result-section">
          <div className="result-detail-table-wrapper">
            <table className="result-detail-table">
              <thead>
                <tr>
                  <th className="row-num-col">#</th>
                  {flattenedFields.map((field) => (
                    <th key={field.name}>{field.name}</th>
                  ))}
                  <th className="action-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {editableRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="row-num-col">{rowIndex + 1}</td>
                    {flattenedFields.map((field) => (
                      <td key={field.name}>
                        <input
                          className="form-input form-input-sm"
                          value={String(row[field.name] ?? '')}
                          onChange={(e) =>
                            updateCell(rowIndex, field.name, e.target.value)
                          }
                        />
                      </td>
                    ))}
                    <td className="action-col">
                      {editableRows.length > 1 && (
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => deleteRow(rowIndex)}
                          title="删除此行"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* 单行数据表单 */
        <div className="result-table">
          {flattenedFields.map((field) => (
            <div key={field.name} className="result-row">
              <label className="result-label">{field.name}</label>
              <input
                className="form-input"
                value={String(editableRows[0]?.[field.name] ?? '')}
                onChange={(e) => updateCell(0, field.name, e.target.value)}
              />
              <span className="result-type-badge">{field.type}</span>
            </div>
          ))}
        </div>
      )}

      <div className="result-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowRaw(!showRaw)}
        >
          {showRaw ? '隐藏原始回复' : '查看原始回复'}
        </button>
      </div>

      {showRaw && (
        <pre className="raw-response">{result.rawResponse}</pre>
      )}

      <div className="form-actions">
        <button className="btn btn-default" onClick={onRetry}>
          重新识别
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onConfirm(editableRows)}
          disabled={inserting || editableRows.length === 0}
        >
          {inserting
            ? '写入中...'
            : `写入多维表格（${editableRows.length} 条）`}
        </button>
      </div>
    </div>
  );
};
