import React, { useState, useEffect } from 'react';
import { Scene, SceneField, FieldType, TableField } from '../types';
import { upsertScene, DEFAULT_PROMPT_TEMPLATE } from '../stores/scene-store';
import { buildPrompt } from '../services/qwen-vl';
import { getTableList, getTableFields } from '../services/bitable';

interface Props {
  scene?: Scene; // 编辑模式传入已有场景
  onSave: () => void;
  onCancel: () => void;
}

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'currency', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'array', label: '数组对象' },
];

// 展开状态的字段路径存储
type FieldPath = string;

export const SceneEditor: React.FC<Props> = ({ scene, onSave, onCancel }) => {
  const [name, setName] = useState(scene?.name || '');
  const [fields, setFields] = useState<SceneField[]>(scene?.fields || []);
  const [imageColumnId, setImageColumnId] = useState(scene?.imageColumnId || '');
  const [uniqueFields, setUniqueFields] = useState<string[]>(scene?.uniqueFields || []);
  const [targetTableId, setTargetTableId] = useState(scene?.targetTableId || '');

  // 表格选择相关
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  const [tableFields, setTableFields] = useState<TableField[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);

  // 预览 prompt
  const [showPreview, setShowPreview] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(scene?.prompt || '');
  const [useCustomPrompt, setUseCustomPrompt] = useState(!!scene?.prompt);

  // 展开的字段路径
  const [expandedPaths, setExpandedPaths] = useState<Set<FieldPath>>(new Set());

  // 加载表格列表
  useEffect(() => {
    loadTables();
  }, []);

  // 当字段结构变化时，清理 uniqueFields 中不在当前扁平化字段列表中的旧值
  // 例如旧数据可能保存了 "物料编码"，修复后应该是 "物料.物料编码"
  useEffect(() => {
    const currentFieldNames = getAllFieldNames(fields);
    setUniqueFields((prev) => {
      const cleaned = prev.filter((f) => currentFieldNames.includes(f));
      if (cleaned.length !== prev.length) {
        return cleaned;
      }
      return prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const loadTables = async () => {
    setLoadingTables(true);
    try {
      const list = await getTableList();
      setTables(list);
    } catch {
      // 不在飞书环境中可能获取失败
    } finally {
      setLoadingTables(false);
    }
  };

  // 当目标表格变化时，加载字段列表
  useEffect(() => {
    if (targetTableId) {
      loadTableFields(targetTableId);
    } else {
      setTableFields([]);
    }
  }, [targetTableId]);

  const loadTableFields = async (tableId: string) => {
    setLoadingFields(true);
    try {
      const fields = await getTableFields(tableId);
      setTableFields(fields);
    } catch {
      setTableFields([]);
    } finally {
      setLoadingFields(false);
    }
  };

  // 从表格导入字段作为OCR字段
  const importFieldsFromTable = async () => {
    if (!targetTableId) {
      alert('请先选择目标数据表');
      return;
    }

    const tableFs = await getTableFields(targetTableId);
    // 排除附件字段
    const importableFields = tableFs.filter((f) => !f.isAttachment);

    if (importableFields.length === 0) {
      alert('该表格没有可导入的字段');
      return;
    }

    // 导入为OCR字段，自动建立映射
    const newFields: SceneField[] = importableFields.map((tf) => ({
      name: tf.name,
      type: tf.type,
      description: '',
      tableFieldId: tf.id,
      tableFieldName: tf.name,
    }));

    setFields(newFields);
  };

  // 添加普通字段
  const addField = () => {
    setFields([...fields, { name: '', type: 'text', description: '' }]);
  };

  // 添加父字段（带分组功能）
  const addGroupField = () => {
    const newField: SceneField = {
      name: '',
      type: 'text',
      description: '',
      isGroup: true,
      children: [],
    };
    setFields([...fields, newField]);
    // 自动展开新添加的父字段
    setExpandedPaths((prev) => new Set(prev).add(String(fields.length)));
  };

  // 添加子字段
  const addChildField = (parentPath: string) => {
    const newFields = [...fields];
    const indices = parentPath.split('.').map(Number);

    let current: SceneField | undefined = newFields[indices[0]];
    for (let i = 1; i < indices.length; i++) {
      current = current?.children?.[indices[i]];
    }

    if (current) {
      // 确保数组对象类型的字段有 children 数组
      if (!current.children) {
        current.children = [];
      }
      current.children.push({ name: '', type: 'text', description: '' });
      setFields(newFields);
      // 确保父字段展开
      setExpandedPaths((prev) => new Set(prev).add(parentPath));
    }
  };

  // 删除字段（支持层级删除）
  const removeField = (path: string) => {
    const indices = path.split('.').map(Number);
    const newFields = [...fields];

    if (indices.length === 1) {
      // 顶层字段
      const removedField = newFields[indices[0]];
      newFields.splice(indices[0], 1);
      setFields(newFields);
      // 从唯一字段中移除
      if (removedField) {
        setUniqueFields((prev) => prev.filter((f) => f !== removedField.name));
      }
    } else {
      // 子字段
      const parentIndices = indices.slice(0, -1);
      let parent: SceneField | undefined = newFields[parentIndices[0]];
      for (let i = 1; i < parentIndices.length; i++) {
        parent = parent?.children?.[parentIndices[i]];
      }
      if (parent?.children) {
        const childIndex = indices[indices.length - 1];
        const removedField = parent.children[childIndex];
        parent.children.splice(childIndex, 1);
        setFields(newFields);
        if (removedField) {
          setUniqueFields((prev) => prev.filter((f) => f !== removedField.name));
        }
      }
    }
  };

  // 更新字段（支持层级更新）
  const updateField = (path: string, key: keyof SceneField, value: string | boolean | SceneField[]) => {
    const indices = path.split('.').map(Number);
    const newFields = [...fields];

    let current: SceneField | undefined = newFields[indices[0]];
    let oldName: string | undefined = current?.name;

    for (let i = 1; i < indices.length; i++) {
      current = current?.children?.[indices[i]];
      if (i === indices.length - 1) {
        oldName = current?.name;
      }
    }

    if (current) {
      // @ts-expect-error - 动态赋值
      current[key] = value;
      setFields(newFields);

      // 如果修改了名称，更新唯一字段引用
      if (key === 'name' && oldName) {
        setUniqueFields((prev) => prev.map((f) => (f === oldName ? String(value) : f)));
      }

      // 如果类型改为数组对象，自动展开并初始化 children
      if (key === 'type' && value === 'array') {
        if (!current.children) {
          current.children = [];
        }
        setExpandedPaths((prev) => new Set(prev).add(path));
      }
    }
  };

  // 更新字段映射（支持层级）
  const updateFieldMapping = (path: string, tableFieldId: string) => {
    const selectedField = tableFields.find((f) => f.id === tableFieldId);
    updateField(path, 'tableFieldId', tableFieldId);
    updateField(path, 'tableFieldName', selectedField?.name || '');
  };

  // 切换展开/折叠
  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  // 切换唯一字段选择
  const toggleUniqueField = (fieldName: string) => {
    setUniqueFields((prev) => {
      if (prev.includes(fieldName)) {
        return prev.filter((f) => f !== fieldName);
      }
      return [...prev, fieldName];
    });
  };

  // 获取所有字段名称（扁平化，用于唯一字段选择）
  // 使用带父级前缀的名称（如 "物料.物料编码"），与 fieldMap 保持一致
  const getAllFieldNames = (fields: SceneField[], prefix = ''): string[] => {
    const names: string[] = [];
    for (const field of fields) {
      if (field.name) {
        const fullName = prefix ? `${prefix}.${field.name}` : field.name;
        if (field.children && field.children.length > 0) {
          // 父字段：递归处理子字段，不将父字段本身加入选择列表
          names.push(...getAllFieldNames(field.children, fullName));
        } else {
          // 叶子字段：加入选择列表
          names.push(fullName);
        }
      }
    }
    return names;
  };

  // 过滤有效的字段（递归）
  const filterValidFields = (fields: SceneField[]): SceneField[] => {
    return fields
      .filter((f) => f.name.trim())
      .map((f) => ({
        ...f,
        children: f.children ? filterValidFields(f.children) : undefined,
      }));
  };

  // 统计字段数量（递归）
  const countFields = (fields: SceneField[]): number => {
    let count = 0;
    for (const field of fields) {
      if (field.name.trim()) {
        count++;
      }
      if (field.children) {
        count += countFields(field.children);
      }
    }
    return count;
  };

  // 渲染字段行（递归支持层级）
  const renderFieldRow = (field: SceneField, path: string, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(path);
    const hasChildren = field.children && field.children.length > 0;
    const isArrayType = field.type === 'array';
    const isGroup = isArrayType || field.isGroup || hasChildren;

    return (
      <div key={path} className="field-item">
        <div
          className={`field-row hierarchical ${isGroup ? 'group-field' : ''}`}
          style={{ paddingLeft: `${depth * 24}px` }}
        >
          {/* 展开/折叠按钮 */}
          {isGroup ? (
            <button
              className="btn-expand"
              onClick={() => toggleExpand(path)}
              title={isExpanded ? '折叠' : '展开'}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="btn-expand-placeholder" />
          )}


          {/* 字段名称输入 */}
          <input
            className="form-input field-name-input"
            value={field.name}
            onChange={(e) => updateField(path, 'name', e.target.value)}
            placeholder={isGroup ? '分组名称（如：物料）' : '字段名称（如：发票号码）'}
          />

          {/* 类型选择 */}
          <select
            className="form-select field-type-select"
            value={field.type}
            onChange={(e) => updateField(path, 'type', e.target.value as FieldType)}
          >
            {FIELD_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* 描述输入 */}
          <input
            className="form-input field-desc-input"
            value={field.description || ''}
            onChange={(e) => updateField(path, 'description', e.target.value)}
            placeholder="字段描述（可选）"
          />

          {/* 表格字段映射 */}
          {targetTableId && (
            <select
              className="form-select field-mapping-select"
              value={field.tableFieldId || ''}
              onChange={(e) => updateFieldMapping(path, e.target.value)}
            >
              <option value="">-- 映射到 --</option>
              {tableFields
                .filter((f) => !f.isAttachment)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          )}

          {/* 操作按钮 */}
          <div className="field-actions">
            {isArrayType && (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => addChildField(path)}
                title="添加子字段"
              >
                + 子字段
              </button>
            )}
            <button
              className="btn btn-danger btn-xs"
              onClick={() => removeField(path)}
              title="删除"
            >
              删除
            </button>
          </div>
        </div>

        {/* 子字段列表 */}
        {isExpanded && isArrayType && (
          <div className="field-children">
            {field.children?.map((child, index) =>
              renderFieldRow(child, `${path}.${index}`, depth + 1)
            )}
            {(!field.children || field.children.length === 0) && (
              <div className="empty-children-hint" style={{ paddingLeft: `${(depth + 1) * 24}px`, color: '#999', fontSize: 12, paddingTop: 4, paddingBottom: 4 }}>
                点击"+ 子字段"添加子字段
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // 保存场景
  const handleSave = () => {
    if (!name.trim()) {
      alert('请输入场景名称');
      return;
    }

    const validFields = filterValidFields(fields);
    if (validFields.length === 0) {
      alert('请至少添加一个识别字段');
      return;
    }

    // 获取图片列名称（用于显示）
    const imageColumnName = tableFields.find((f) => f.id === imageColumnId)?.name || '';

    const sceneData: Scene = {
      id: scene?.id || `custom-${Date.now()}`,
      name: name.trim(),
      description: '',
      prompt: useCustomPrompt ? customPrompt : undefined,
      fields: validFields,
      builtIn: false,
      createdAt: scene?.createdAt || Date.now(),
      updatedAt: Date.now(),
      imageColumnId: imageColumnId || undefined,
      imageColumnName: imageColumnName || undefined,
      uniqueFields: (() => {
        // 保存时再次过滤，确保只保留有效的扁平化字段名
        const validNames = getAllFieldNames(validFields);
        const validUnique = uniqueFields.filter((f) => validNames.includes(f));
        return validUnique.length > 0 ? validUnique : undefined;
      })(),
      targetTableId: targetTableId || undefined,
    };

    upsertScene(sceneData);
    onSave();
  };

  // 预览 prompt
  const previewPrompt = buildPrompt({
    ...({} as Scene),
    id: 'preview',
    name: name || '预览',
    description: '',
    prompt: useCustomPrompt ? customPrompt : DEFAULT_PROMPT_TEMPLATE,
    fields: filterValidFields(fields),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  // 获取有效的字段数量
  const validFieldCount = countFields(fields);
  const allFieldNames = getAllFieldNames(fields);

  return (
    <div className="scene-editor">
      <div className="section-header">
        <h3>{scene ? '编辑场景' : '新建场景'}</h3>
      </div>

      {/* 基本信息 */}
      <div className="form-group">
        <label className="form-label">场景名称 *</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：增值税发票"
        />
      </div>

      {/* 目标表格 */}
      <div className="form-group">
        <label className="form-label">目标数据表</label>
        <select
          className="form-select"
          value={targetTableId}
          onChange={(e) => setTargetTableId(e.target.value)}
          disabled={loadingTables}
        >
          <option value="">{loadingTables ? '加载中...' : '请选择数据表...'}</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="form-hint">
          选择要写入识别结果的目标数据表，选择后可配置字段映射关系
        </div>
      </div>

      {/* 识别字段配置 */}
      <div className="form-group">
        <div className="fields-header-row">
          <label className="form-label">识别字段（共 {validFieldCount} 个）</label>
          <button className="btn btn-ghost btn-sm" onClick={addField}>
            + 添加字段
          </button>
        </div>

        {/* 字段列表 */}
        {fields.length === 0 ? (
          <div className="empty-fields-hint">
            点击"添加字段"开始配置要从图片中提取的字段
          </div>
        ) : (
          <div className="hierarchical-fields">
            {fields.map((field, index) => renderFieldRow(field, String(index), 0))}
          </div>
        )}

        <div className="form-hint">
          普通字段直接识别，数组对象类型可包含多个子字段（如"物料"包含"物料名称"、"物料编码"等）
        </div>
      </div>

      {/* 图片列选择 */}
      {tableFields.length > 0 && (
        <div className="form-group">
          <label className="form-label">图片列（用于批量识别）</label>
          <select
            className="form-select"
            value={imageColumnId}
            onChange={(e) => setImageColumnId(e.target.value)}
          >
            <option value="">不指定（手动上传图片）</option>
            {tableFields
              .filter((f) => f.isAttachment)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
          <div className="form-hint">
            指定图片列后，可以从表格中批量读取图片进行识别。只有附件类型的字段会显示在列表中。
          </div>
        </div>
      )}

      {/* 唯一字段选择 */}
      {allFieldNames.length > 0 && (
        <div className="form-group">
          <label className="form-label">唯一字段（用于更新匹配）</label>
          <div className="unique-fields-selector">
            {allFieldNames.map((fieldName) => (
              <label key={fieldName} className="unique-field-option">
                <input
                  type="checkbox"
                  checked={uniqueFields.includes(fieldName)}
                  onChange={() => toggleUniqueField(fieldName)}
                />
                <span>{fieldName}</span>
              </label>
            ))}
          </div>
          <div className="form-hint">
            选择用于匹配现有记录的唯一字段。如果匹配到记录则更新，否则新增。不选则全部新增。
          </div>
        </div>
      )}

      {/* 高级设置：自定义 Prompt */}
      <div className="form-group">
        <div className="checkbox-row">
          <input
            type="checkbox"
            id="useCustomPrompt"
            checked={useCustomPrompt}
            onChange={(e) => setUseCustomPrompt(e.target.checked)}
          />
          <label htmlFor="useCustomPrompt">使用自定义提示词（高级）</label>
        </div>

        {useCustomPrompt && (
          <>
            <textarea
              className="form-textarea"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={6}
              placeholder="输入提示词模板，使用 {fields_placeholder} 作为字段列表占位符"
            />
            <div className="form-hint">
              使用 {'{fields_placeholder}'} 作为字段列表的占位符
            </div>
          </>
        )}

        <button
          className="btn btn-ghost btn-sm mt-2"
          onClick={() => setShowPreview(!showPreview)}
        >
          {showPreview ? '隐藏提示词预览' : '查看提示词预览'}
        </button>
      </div>

      {showPreview && (
        <div className="form-group">
          <label className="form-label">提示词预览</label>
          <pre className="prompt-preview">{previewPrompt}</pre>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="form-actions">
        <button className="btn btn-default" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  );
};
