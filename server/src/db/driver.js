'use strict';

/**
 * 数据库驱动适配层
 *
 * 优先用 better-sqlite3（装了就有，快一点）；
 * 没装就用 Node 自带的 node:sqlite。
 *
 * 两者 API 形状很接近，这里抹平成同一套：
 *   db.exec(sql) / db.pragma(stmt) / db.prepare(sql) / db.transaction(fn) / db.close()
 *
 * 这样用户就不必为了装个教室管理软件去装 Visual Studio 编译工具。
 */

function loadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    // 装了一半的包 require 不一定炸，所以建个内存库探一下
    const probe = new Database(':memory:');
    probe.close();
    return Database;
  } catch (_) {
    return null;
  }
}

function loadNodeSqlite() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return DatabaseSync;
  } catch (_) {
    return null;
  }
}

function openDatabase(file) {
  const BetterSqlite3 = loadBetterSqlite3();
  const NodeSqlite = BetterSqlite3 ? null : loadNodeSqlite();

  if (!BetterSqlite3 && !NodeSqlite) {
    throw new Error(
      '没有可用的 SQLite 驱动。\n' +
        '  方案一：升级到 Node 22.5+（推荐 24），它自带 node:sqlite；\n' +
        '  方案二：npm install better-sqlite3（需要 C++ 编译工具链）。'
    );
  }

  const impl = BetterSqlite3 ? 'better-sqlite3' : 'node:sqlite';
  const raw = BetterSqlite3 ? new BetterSqlite3(file) : new NodeSqlite(file);

  const db = {
    impl,
    raw,

    /** 执行一段 SQL，可以多条 */
    exec(sql) {
      raw.exec(sql);
      return db;
    },

    /** PRAGMA 语句，两种驱动都没有统一的 pragma() 方法，直接当 SQL 走 */
    pragma(statement) {
      try {
        raw.exec(`PRAGMA ${statement}`);
      } catch (err) {
        // 有些 pragma 在内存库上会报错，不值得为它中断启动
        if (!/memory/i.test(String(err.message))) throw err;
      }
      return db;
    },

    /** 预编译语句：返回的 StatementSync / Statement API 是一致的 */
    prepare(sql) {
      return raw.prepare(sql);
    },

    /**
     * 事务：返回一个可调用的包装函数
     * 用法跟 better-sqlite3 一样：const run = db.transaction(() => {...}); run();
     */
    transaction(fn) {
      return (...args) => {
        raw.exec('BEGIN');
        try {
          const result = fn(...args);
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            raw.exec('ROLLBACK');
          } catch (_) {
            /* 已经回滚过了 */
          }
          throw err;
        }
      };
    },

    close() {
      try {
        raw.close();
      } catch (_) {
        /* 忽略重复关闭 */
      }
    },
  };

  return db;
}

module.exports = { openDatabase };
