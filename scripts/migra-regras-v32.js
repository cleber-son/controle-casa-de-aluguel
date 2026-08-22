/**
 * Migração das regras (v3.2) — idempotente, pode rodar de novo sem estragar.
 *
 *  - acrescenta a regra de bom senso sobre som alto (volume no dia a dia,
 *    complementando o "Silêncio das 22h às 7h", que só cobre a madrugada);
 *  - deixa a nova regra logo depois da regra de silêncio;
 *  - renumera a ordem no fim.
 *
 * Uso: node scripts/migra-regras-v32.js
 */
const db = require('../modules/db.js');

const NOVAS = [
  {
    categoria: 'convivencia',
    titulo: 'Som alto: use o bom senso',
    texto: 'Som, caixinha, TV, celular no viva-voz e som de carro: mantenha num volume que não invada a casa do vizinho. ' +
      'Aqui as paredes são coladas e o quintal é de todo mundo — o que para você está normal, para o outro está dentro do quarto. ' +
      'Vale o dia inteiro, não só à noite: se dá para ouvir a sua música na casa do vizinho, está alto demais. ' +
      'Se alguém pedir para abaixar, abaixe na hora e sem discussão — na semana seguinte pode ser você pedindo.',
  },
];

// ordem final desejada (por título); o que não estiver aqui vai para o fim
const ORDEM = [
  'Silêncio das 22h às 7h',
  'Som alto: use o bom senso',
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

const tx = db.transaction(() => {
  for (const n of NOVAS) {
    const ja = db.prepare('SELECT id FROM regras WHERE titulo = ?').get(n.titulo);
    if (ja) {
      db.prepare('UPDATE regras SET categoria = ?, texto = ?, ativa = 1 WHERE id = ?')
        .run(n.categoria, n.texto, ja.id);
      console.log(`= atualizada: ${n.titulo}`);
    } else {
      const ordem = (db.prepare('SELECT COALESCE(MAX(ordem), 0) AS m FROM regras').get().m) + 1;
      db.prepare('INSERT INTO regras (ordem, categoria, titulo, texto, ativa) VALUES (?, ?, ?, ?, 1)')
        .run(ordem, n.categoria, n.titulo, n.texto);
      console.log(`+ criada: ${n.titulo}`);
    }
  }

  const todas = db.prepare('SELECT id, titulo FROM regras ORDER BY ordem, id').all();
  const upd = db.prepare('UPDATE regras SET ordem = ? WHERE id = ?');
  let i = 0;
  for (const titulo of ORDEM) {
    const r = todas.find((x) => x.titulo === titulo);
    if (r) upd.run(++i, r.id);
  }
  for (const r of todas) {
    if (!ORDEM.includes(r.titulo)) upd.run(++i, r.id);
  }
  console.log(`ordem renumerada (${i} regras)`);
});

tx();
console.log('migração v3.2 concluída');
