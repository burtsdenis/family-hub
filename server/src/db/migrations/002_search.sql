-- Полнотекстовый поиск.
-- Токенизатор trigram выбран сознательно: он ищет по подстроке и поэтому
-- корректно работает с русской морфологией без стеммера —
-- запрос «переезд» находит «переезда», «переезду», «переездом».
-- Требование: минимум 3 символа в запросе.

CREATE VIRTUAL TABLE search_index USING fts5(
  entity        UNINDEXED,   -- 'note' | 'task' | 'project'
  entity_id     UNINDEXED,
  visibility    UNINDEXED,   -- 'shared' | 'private'
  owner_id      UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);

-- Заметки

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('note', new.id, new.visibility, coalesce(new.owner_id, ''), new.title, new.body_md);
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM search_index WHERE entity = 'note' AND entity_id = old.id;
END;

CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM search_index WHERE entity = 'note' AND entity_id = old.id;
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('note', new.id, new.visibility, coalesce(new.owner_id, ''), new.title, new.body_md);
END;

-- Задачи

CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('task', new.id, 'shared', '', new.title, coalesce(new.description, ''));
END;

CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE entity = 'task' AND entity_id = old.id;
END;

CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE entity = 'task' AND entity_id = old.id;
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('task', new.id, 'shared', '', new.title, coalesce(new.description, ''));
END;

-- Проекты

CREATE TRIGGER projects_ai AFTER INSERT ON projects BEGIN
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('project', new.id, 'shared', '', new.title, coalesce(new.description, ''));
END;

CREATE TRIGGER projects_ad AFTER DELETE ON projects BEGIN
  DELETE FROM search_index WHERE entity = 'project' AND entity_id = old.id;
END;

CREATE TRIGGER projects_au AFTER UPDATE ON projects BEGIN
  DELETE FROM search_index WHERE entity = 'project' AND entity_id = old.id;
  INSERT INTO search_index (entity, entity_id, visibility, owner_id, title, body)
  VALUES ('project', new.id, 'shared', '', new.title, coalesce(new.description, ''));
END;
