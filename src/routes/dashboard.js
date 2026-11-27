import { all, get } from '../db.js';

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function register(router) {
  router.get('/api/dashboard', () => {
    const thisMonth = monthKey();
    const counts = Object.fromEntries(['quote', 'contract', 'delivery'].map((t) => [t,
      get('SELECT COUNT(*) AS c FROM documents WHERE type=? AND substr(doc_date,1,7)=?', t, thisMonth).c]));
    const amount = {};
    for (const t of ['quote', 'contract', 'delivery']) {
      amount[t] = get("SELECT COALESCE(SUM(amount),0) AS s FROM documents WHERE type=? AND status NOT IN ('canceled','closed')", t).s;
    }

    const status = all('SELECT type,status,COUNT(*) AS c FROM documents GROUP BY type,status');

    const recent = all(`SELECT d.id,d.doc_no,d.type,d.status,d.doc_date,d.amount,d.title,c.name AS customer_name
      FROM documents d LEFT JOIN customers c ON c.id=d.customer_id
      ORDER BY d.id DESC LIMIT 10`);

    const trend = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      trend.push({
        month: key,
        contract_amount: get("SELECT COALESCE(SUM(amount),0) AS s FROM documents WHERE type='contract' AND substr(doc_date,1,7)=? AND status<>'canceled'", key).s,
        doc_count: get('SELECT COUNT(*) AS c FROM documents WHERE substr(doc_date,1,7)=?', key).c,
      });
    }

    const tasks = {
      quote_no_contract: all(`SELECT d.id,d.doc_no,d.doc_date,d.amount,c.name AS customer_name FROM documents d
        LEFT JOIN customers c ON c.id=d.customer_id
        WHERE d.type='quote' AND d.status<>'closed' AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id=d.id AND x.type='contract')
        ORDER BY d.id DESC LIMIT 8`),
      contract_no_delivery: all(`SELECT d.id,d.doc_no,d.doc_date,d.amount,c.name AS customer_name FROM documents d
        LEFT JOIN customers c ON c.id=d.customer_id
        WHERE d.type='contract' AND d.status IN ('signed','delivering') AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id=d.id AND x.type='delivery')
        ORDER BY d.id DESC LIMIT 8`),
    };

    const topCustomers = all(`SELECT c.id,c.name,COALESCE(SUM(d.amount),0) AS amount,COUNT(*) AS docs
      FROM documents d JOIN customers c ON c.id=d.customer_id
      WHERE d.type='contract' AND d.status<>'canceled' GROUP BY c.id ORDER BY amount DESC LIMIT 5`);

    return { month: thisMonth, counts, amount, status, recent, trend, tasks, top_customers: topCustomers,
      customers: get('SELECT COUNT(*) AS c FROM customers').c,
      products: get('SELECT COUNT(*) AS c FROM products').c,
      files: get('SELECT COUNT(*) AS c FROM files').c };
  });
}
