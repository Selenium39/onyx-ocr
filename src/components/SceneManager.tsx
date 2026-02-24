import React from 'react';
import { Scene } from '../types';
import { getScenes, deleteScene, getEnabledFields } from '../stores/scene-store';

interface Props {
  onSelect: (scene: Scene) => void;
  onEdit: (scene: Scene) => void;
  onCreate: () => void;
}

export const SceneManager: React.FC<Props> = ({ onSelect, onEdit, onCreate }) => {
  const [scenes, setScenes] = React.useState<Scene[]>([]);

  React.useEffect(() => {
    setScenes(getScenes());
  }, []);

  const handleDelete = (id: string) => {
    if (window.confirm('确定要删除这个场景吗？')) {
      deleteScene(id);
      setScenes(getScenes());
    }
  };

  return (
    <div className="scene-manager">
      <div className="section-header">
        <h3>场景管理</h3>
        <button className="btn btn-primary btn-sm" onClick={onCreate}>
          + 新建场景
        </button>
      </div>

      {scenes.length === 0 ? (
        <div className="empty-scenes-hint">
          暂无场景，点击"+ 新建场景"创建一个
        </div>
      ) : (
        <div className="scene-group">
          {scenes.map((scene) => (
            <div key={scene.id} className="scene-card">
              <div className="scene-card-info" onClick={() => onSelect(scene)}>
                <div className="scene-card-name">{scene.name}</div>
                <div className="scene-card-meta">
                  {getEnabledFields(scene).length} 个字段
                  {scene.imageColumnName && ` · 图片列: ${scene.imageColumnName}`}
                  {scene.uniqueFields && scene.uniqueFields.length > 0 && ` · 唯一: ${scene.uniqueFields.join(',')}`}
                </div>
              </div>
              <div className="scene-card-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onSelect(scene)}
                >
                  使用
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onEdit(scene)}
                >
                  编辑
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(scene.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
