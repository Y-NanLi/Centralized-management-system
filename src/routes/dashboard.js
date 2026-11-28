import { all, get } from '../db.js';
import { requestedOwner } from '../scope.js';

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function register(router) {
  router.get('/api/dashboard', (ctx) => {
    const owner = requestedOwner(ctx.user, ctx.query);
    const own = ' AND d.deleted_at IS NULL' + (owner ? ' AND d.owner_id=?' : '');
    const p = owner ? [owner] : [];
    const thisMonth = monthKey();
    const counts = Object.fromEntries(['quote', 'contract', 'delivery'].map((t) => [t,
      get(`SELECT COUNT(*) AS c FROM documents d WHERE d.type=? AND substr(d.doc_date,1,7)=?${own}`, t, thisMonth, ...p).c]));
    const amount = {};
    for (const t of ['quote', 'contract', 'delivery']) {
      amount[t] = get(`SELECT COALESCE(SUM(d.amount),0) AS s FROM documents d WHERE d.type=? AND d.status NOT IN ('canceled','closed')${own}`, t, ...p).s;
    }

    const status = all(`SELECT d.type,d.status,COUNT(*) AS c FROM documents d WHERE 1=1${own} GROUP BY d.type,d.status`, ...p);

    const recent = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,c.name AS customer_name,
      u.name AS owner_name, u.username AS owner_username
      FROM documents d LEFT JOIN customers c ON c.id=d.customer_id LEFT JOIN users u ON u.id=d.owner_id
      WHERE 1=1${own}
      ORDER BY d.id DESC LIMIT 10`, ...p);

    const trend = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      trend.push({
        month: key,
        contract_amount: get(`SELECT COALESCE(SUM(d.amount),0) AS s FROM documents d WHERE d.type='contract' AND substr(d.doc_date,1,7)=? AND d.status<>'canceled'${own}`, key, ...p).s,
        doc_count: get(`SELECT COUNT(*) AS c FROM documents d WHERE substr(d.doc_date,1,7)=?${own}`, key, ...p).c,
      });
    }

    const tasks = {
      quote_no_contract: all(`SELECT d.id,d.doc_no,d.doc_date,d.amount,c.name AS customer_name FROM documents d
        LEFT JOIN customers c ON c.id=d.customer_id
        WHERE d.type='quote' AND d.status<>'closed'${own} AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id=d.id AND x.type='contract' AND x.deleted_at IS NULL)
        ORDER BY d.id DESC LIMIT 8`, ...p),
      contract_no_delivery: all(`SELECT d.id,d.doc_no,d.doc_date,d.amount,c.name AS customer_name FROM documents d
        LEFT JOIN customers c ON c.id=d.customer_id
        WHERE d.type='contract' AND d.status IN ('signed','delivering')${own} AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id=d.id AND x.type='delivery' AND x.deleted_at IS NULL)
        ORDER BY d.id DESC LIMIT 8`, ...p),
    };

    const topCustomers = all(`SELECT c.id,c.name,COALESCE(SUM(d.amount),0) AS amount,COUNT(*) AS docs
      FROM documents d JOIN customers c ON c.id=d.customer_id
      WHERE d.type='contract' AND d.status<>'canceled'${own} GROUP BY c.id ORDER BY amount DESC LIMIT 5`, ...p);

    const ownerRow = owner ? get('SELECT id,name,username,role FROM users WHERE id=?', owner) : null;
    const ownerName = owner
      ? (ownerRow && (ownerRow.role === 'guest' ? `游客 #${owner}` : (ownerRow.name || ownerRow.username))) || `成员 #${owner}`
      : '';

    return {
      owner_id: owner,
      owner_name: ownerName,
      month: thisMonth, counts, amount, status, recent, trend, tasks, top_customers: topCustomers,
      customers: get(`SELECT COUNT(*) AS c FROM customers${owner ? ' WHERE created_by=?' : ''}`, ...(owner ? [owner] : [])).c,
      products: get(`SELECT COUNT(*) AS c FROM products${owner ? ' WHERE owner_id=?' : ''}`, ...(owner ? [owner] : [])).c,
      files: get(`SELECT COUNT(*) AS c FROM files WHERE deleted_at IS NULL${owner ? ' AND owner_id=?' : ''}`, ...(owner ? [owner] : [])).c,
    };
  });
}
