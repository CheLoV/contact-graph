-- FTS5 виртуальная таблица для полнотекстового поиска по сообщениям (День 5).
-- content='Message' + content_rowid='rowid' — индекс хранит ссылки на rowid,
-- сами тексты не дублируются. tokenize=unicode61 даёт нормальную работу
-- с кириллицей; remove_diacritics=2 — diacritic-insensitive поиск.
CREATE VIRTUAL TABLE "messages_fts" USING fts5(
  text,
  content='Message',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Триггеры для автоподдержки индекса при обычных INSERT/UPDATE/DELETE.
-- На время bulk-импорта (Telegram) импортёр временно дропает _insert и _update,
-- делает createMany, потом пересоздаёт их и зовёт INSERT INTO messages_fts(messages_fts) VALUES('rebuild').
CREATE TRIGGER "messages_fts_insert" AFTER INSERT ON "Message" BEGIN
  INSERT INTO "messages_fts"(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER "messages_fts_delete" AFTER DELETE ON "Message" BEGIN
  INSERT INTO "messages_fts"("messages_fts", rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER "messages_fts_update" AFTER UPDATE ON "Message" BEGIN
  INSERT INTO "messages_fts"("messages_fts", rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO "messages_fts"(rowid, text) VALUES (new.rowid, new.text);
END;
