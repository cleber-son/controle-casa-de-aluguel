/**
 * Migração pontual das regras (v3.1) — idempotente, pode rodar de novo sem estragar.
 *
 *  - remove as categorias veículos, manutenção e saída;
 *  - troca a regra de animais por "proibidos, só com autorização do dono";
 *  - acrescenta os cuidados com o animal autorizado;
 *  - reforça "nada de objetos no corredor" e "manter o ambiente limpo";
 *  - renumera a ordem no fim.
 *
 * Uso: node scripts/migra-regras-v31.js
 */
const db = require('../modules/db.js');

const REMOVER_CATS = ['veiculos', 'manutencao', 'saida'];

// título -> como a regra deve ficar. Casa pelo título antigo OU pelo novo.
const ALVOS = [
  { de: 'Animal só com autorização', categoria: 'animais', titulo: 'Animais são proibidos',
    texto: 'Não é permitido ter animal nas casas. A única exceção é com autorização do dono da casa, combinada antes. Sem essa autorização, não pode — nem "por uns dias", nem animal de visita.' },
  { de: 'Passagem sempre livre', categoria: 'seguranca', titulo: 'Nada de objetos no corredor',
    texto: 'O corredor e a passagem do quintal ficam sempre livres. Não deixe móvel, entulho, bicicleta, caixa, material de obra nem nada parado ali — é passagem de todo mundo e saída de emergência.' },
];

const NOVAS = [
  { categoria: 'animais', titulo: 'Cuidados com o animal autorizado',
    texto: 'Se o dono da casa autorizou, o morador é o único responsável pelo animal: na coleira sempre que sair da casa, nunca solto no quintal, fezes recolhidas na hora, comida e água só dentro da casa (ração no quintal atrai bicho), vacina em dia, e latido ou barulho controlado — principalmente das 22h às 7h. Qualquer estrago que o animal fizer é o morador quem paga, e a autorização pode ser cancelada se as combinações não forem cumpridas.' },
  { categoria: 'limpeza', titulo: 'Manter o ambiente limpo',
    texto: 'Quintal, corredor, área comum e lavanderia sempre limpos. Usou, limpou. Sujou, limpou na hora — ninguém limpa a bagunça do outro.' },
];

// ordem final desejada (por título); o que não estiver aqui vai para o fim
const ORDEM = [
  'Silêncio das 22h às 7h',
  'Festa só combinando antes',
  'Água é dividida por pessoa',
  'Luz é dividida por relógio',
  'Pagar até a data combinada',
  'Manter o ambiente limpo',
  'Cada um cuida da sua frente',
  'Lixo só em saco fechado',
  'Nada de objetos no corredor',
  'Área comum e varal são de todos',
  'Animais são proibidos',
  'Cuidados com o animal autorizado',
  'Visita é responsabilidade do morador',
  'Nada de gambiarra elétrica nem fogo',
];

const porTitulo = (t) => db.prepare('SELECT * FROM regras WHERE titulo = ?').get(t);

db.transaction(() => {
  for (const c of REMOVER_CATS) {
    const n = db.prepare('DELETE FROM regras WHERE categoria = ?').run(c).changes;
    if (n) console.log(`removidas ${n} regra(s) da categoria "${c}"`);
  }

  for (const a of ALVOS) {
    const atual = porTitulo(a.de) || porTitulo(a.titulo);
    if (!atual) { console.log(`! não achei "${a.de}" — pulando`); continue; }
    db.prepare('UPDATE regras SET categoria = ?, titulo = ?, texto = ? WHERE id = ?')
      .run(a.categoria, a.titulo, a.texto, atual.id);
    console.log(`atualizada: ${a.titulo}`);
  }

  for (const n of NOVAS) {
    if (porTitulo(n.titulo)) { console.log(`já existe: ${n.titulo}`); continue; }
    const fim = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 AS o FROM regras').get().o;
    db.prepare('INSERT INTO regras (ordem, categoria, titulo, texto, ativa) VALUES (?,?,?,?,1)')
      .run(fim, n.categoria, n.titulo, n.texto);
    console.log(`criada: ${n.titulo}`);
  }

  const todas = db.prepare('SELECT id, titulo FROM regras ORDER BY ordem, id').all();
  const peso = (t) => { const i = ORDEM.indexOf(t); return i < 0 ? 999 : i; };
  todas.sort((a, b) => peso(a.titulo) - peso(b.titulo));
  const up = db.prepare('UPDATE regras SET ordem = ? WHERE id = ?');
  todas.forEach((r, i) => up.run(i + 1, r.id));
  console.log(`ordem renumerada (${todas.length} regras)`);
})();

console.log('\nComo ficou:');
for (const r of db.prepare('SELECT ordem, categoria, titulo FROM regras ORDER BY ordem').all()) {
  console.log(`  ${String(r.ordem).padStart(2)} | ${r.categoria.padEnd(12)} | ${r.titulo}`);
}
