// modules/contrato.js — gera o contrato de locação residencial (Lei 8.245/91)
// em HTML pronto para imprimir / salvar em PDF.
//
// Entradas: as partes do local (proprietários, procurador, endereço do imóvel)
// e os dados de um contrato (inquilino, valor, prazo, garantia...). Campo vazio
// vira uma linha "__________" para preencher à mão — o contrato sempre sai.

const LOCAIS = {
  diadema: {
    nome: 'Diadema',
    procuracao: true,
    foro: 'Diadema/SP',
    encargos: 'as contas de água e de energia elétrica, rateadas entre as casas do imóvel conforme ' +
      'o regulamento interno: a água é dividida pelo número de moradores de cada casa e a energia ' +
      'pelo relógio medidor que atende a casa. Os valores são informados mensalmente ao LOCATÁRIO ' +
      'e vencem junto com o aluguel',
  },
  porto_seguro: {
    nome: 'Porto Seguro',
    procuracao: false,
    foro: 'Porto Seguro/BA',
    encargos: 'as contas de consumo de água, energia elétrica, gás e internet do imóvel, que deverão ' +
      'ser pagas diretamente às concessionárias nos respectivos vencimentos, além da taxa de coleta ' +
      'de lixo e do IPTU proporcional ao período da locação',
  },
};

const INDICES = ['IGP-M', 'IPCA', 'INPC'];

// ── texto ────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LINHA = '<span class="lacuna">______________________</span>';

// valor (já escapado) ou lacuna para preencher à mão
function v(s) {
  const t = String(s == null ? '' : s).trim();
  return t ? esc(t) : LINHA;
}

function brl(n) {
  return 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

function dataBR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return LINHA;
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function dataExtenso(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '____ de ______________ de ______';
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

// último dia do contrato: início + N meses − 1 dia
function dataFim(iso, meses) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !(meses > 0)) return null;
  const [a, m, d] = iso.split('-').map(Number);
  const fim = new Date(Date.UTC(a, m - 1 + meses, d));
  // 31/01 + 1 mês "transborda" para março: termina no último dia de fevereiro
  if (fim.getUTCDate() !== d) fim.setUTCDate(0);
  else fim.setUTCDate(fim.getUTCDate() - 1);
  return fim.toISOString().slice(0, 10);
}

// ── número por extenso (reais) ───────────────────────────────────

const UN = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze',
  'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100), r = n % 100;
  if (c) partes.push(CEM[c]);
  if (r < 20) { if (r) partes.push(UN[r]); }
  else {
    const d = Math.floor(r / 10), u = r % 10;
    partes.push(u ? `${DEZ[d]} e ${UN[u]}` : DEZ[d]);
  }
  return partes.join(' e ');
}

function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1e6), milhares = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  const grupos = [];
  if (milhoes) grupos.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
  if (milhares) grupos.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
  if (resto) grupos.push(ate999(resto));
  // "mil e quinhentos", "mil e oitenta", mas "mil trezentos e cinquenta"
  let txt = grupos[0];
  for (let i = 1; i < grupos.length; i++) {
    const ultimo = i === grupos.length - 1;
    const simples = resto < 100 || resto % 100 === 0;
    txt += (ultimo && simples ? ' e ' : ' ') + grupos[i];
  }
  return txt;
}

function reaisExtenso(valor) {
  const centavosTot = Math.round(Number(valor || 0) * 100);
  const reais = Math.floor(centavosTot / 100), cent = centavosTot % 100;
  const partes = [];
  if (reais) {
    const de = reais % 1e6 === 0 ? ' de' : '';
    partes.push(`${inteiroExtenso(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero reais';
}

function numExtenso(n) {
  return inteiroExtenso(Math.max(0, Math.round(Number(n) || 0)));
}

// ── qualificação das partes ──────────────────────────────────────

function preenchida(p) {
  return !!(p && String(p.nome || '').trim());
}

// "FULANO, brasileiro, casado, pedreiro, RG nº X, CPF nº Y, residente em Z"
function qualificacao(p, { endereco = true } = {}) {
  p = p || {};
  const nome = String(p.nome || '').trim();
  const partes = [
    nome ? `<strong>${esc(nome.toUpperCase())}</strong>` : LINHA,
    v(p.nacionalidade || 'brasileiro(a)'),
    v(p.estado_civil),
    v(p.profissao),
    `portador(a) do RG nº ${v(p.rg)}`,
    `inscrito(a) no CPF sob o nº ${v(p.cpf)}`,
  ];
  if (endereco) partes.push(`residente e domiciliado(a) em ${v(p.endereco)}`);
  return partes.join(', ');
}

function blocoLocador(local, partes) {
  const props = (partes.proprietarios || []).filter(preenchida);
  const lista = props.length ? props : [{}];
  const quals = lista.map((p) => qualificacao(p)).join('; e ');
  const plural = lista.length > 1;
  if (!LOCAIS[local].procuracao) {
    return `<p><strong>LOCADOR${plural ? 'ES' : ''}:</strong> ${quals}.</p>`;
  }
  return `<p><strong>LOCADOR${plural ? 'ES' : ''}:</strong> ${quals}; ` +
    `${plural ? 'neste ato representados' : 'neste ato representado(a)'} por seu procurador ` +
    `${qualificacao(partes.procurador)}, nos termos da procuração ${v(partes.procuracao)}, ` +
    'cuja cópia integra este contrato.</p>';
}

// ── contrato ─────────────────────────────────────────────────────

function clausulaGarantia(d) {
  if (d.garantia === 'caucao') {
    const valor = Number(d.caucao_valor) || 0;
    return `Como garantia das obrigações deste contrato, o LOCATÁRIO entrega ao LOCADOR, a título de ` +
      `caução (art. 38 da Lei 8.245/91), a quantia de <strong>${valor ? brl(valor) : LINHA}</strong>` +
      `${valor ? ` (${reaisExtenso(valor)})` : ''}, que será devolvida ao final da locação, após a ` +
      'entrega das chaves e a vistoria do imóvel, descontados eventuais aluguéis, encargos, multas ' +
      'ou reparos de danos que estejam em aberto. A caução não pode ser usada pelo LOCATÁRIO para ' +
      'pagar os últimos aluguéis.';
  }
  if (d.garantia === 'fiador') {
    return `Assina este contrato como FIADOR e principal pagador, solidariamente responsável por todas ` +
      `as obrigações do LOCATÁRIO até a efetiva entrega das chaves, ainda que a locação seja ` +
      `prorrogada por prazo indeterminado: ${v(d.fiador)}. O FIADOR renuncia ao benefício de ordem ` +
      'previsto no art. 827 do Código Civil.';
  }
  return 'A presente locação é contratada sem garantia locatícia.';
}

function gerar({ local, partes, contrato, casa, regras }) {
  const cfg = LOCAIS[local];
  partes = partes || {};
  const d = contrato.dados || {};
  const inq = d.inquilino || {};

  const valor = Number(d.valor_aluguel) || 0;
  const prazo = Number(d.prazo_meses) || 0;
  const dia = Number(d.dia_vencimento) || 0;
  const fim = dataFim(d.inicio, prazo);
  const multa = Number(d.multa_atraso_pct ?? 10);
  const juros = Number(d.juros_mes_pct ?? 1);
  const multaResc = Number(d.multa_rescisao_alugueis ?? 3);
  const indice = INDICES.includes(d.reajuste_indice) ? d.reajuste_indice : 'IGP-M';
  const foro = String(partes.foro || '').trim() || cfg.foro;
  const cidadeAss = String(d.cidade_assinatura || '').trim() || foro.split('/')[0];
  const encargos = String(d.encargos || '').trim() || cfg.encargos;
  const imovelDesc = String(d.imovel || '').trim() || (casa ? `Casa ${casa.numero}` : '');
  const anexarRegras = local === 'diadema' && d.anexar_regras !== false && regras && regras.length;

  let n = 0;
  const cl = (titulo, corpo) => `<h3>CLÁUSULA ${++n}ª — ${titulo}</h3>${corpo}`;
  const p = (t) => `<p>${t}</p>`;

  const ocupantes = String(d.ocupantes || '').trim();
  const animais = d.animais === 'autorizado'
    ? 'Fica autorizada a permanência do(s) seguinte(s) animal(is) de estimação: ' +
      `${v(d.animais_desc)}. O LOCATÁRIO responde por qualquer dano, sujeira ou incômodo causado ` +
      'por eles, e a autorização pode ser revogada se as regras de convivência forem descumpridas.'
    : 'É proibido manter animais de qualquer espécie no imóvel sem autorização prévia e por escrito ' +
      'do LOCADOR.';

  const corpo = [
    `<h1>CONTRATO DE LOCAÇÃO RESIDENCIAL</h1>`,
    blocoLocador(local, partes),
    `<p><strong>LOCATÁRIO:</strong> ${qualificacao(inq, { endereco: false })}` +
      `${inq.telefone ? `, telefone ${esc(inq.telefone)}` : ''}` +
      `${inq.email ? `, e-mail ${esc(inq.email)}` : ''}.</p>`,
    p('As partes acima identificadas têm entre si, justo e contratado, a locação do imóvel descrito ' +
      'abaixo, que se regerá pela Lei nº 8.245/91 e pelas cláusulas seguintes.'),

    cl('DO OBJETO', [
      p(`O LOCADOR dá em locação ao LOCATÁRIO o imóvel residencial <strong>${v(imovelDesc)}</strong>, ` +
        `situado em ${v(partes.endereco_imovel)}${d.imovel_complemento ? `, ${esc(d.imovel_complemento)}` : ''}.`),
      p('O imóvel destina-se exclusivamente à moradia do LOCATÁRIO' +
        (ocupantes ? ` e das seguintes pessoas: ${esc(ocupantes)}` : ' e de sua família') +
        '. É vedado sublocar, ceder, emprestar ou transferir o imóvel, no todo ou em parte, bem como ' +
        'mudar a sua destinação, sem consentimento prévio e por escrito do LOCADOR.'),
    ].join('')),

    cl('DO PRAZO', [
      p(`A locação tem prazo de <strong>${prazo ? `${prazo} (${numExtenso(prazo)}) meses` : LINHA}</strong>, ` +
        `com início em <strong>${dataBR(d.inicio)}</strong> e término em <strong>${fim ? dataBR(fim) : LINHA}</strong>, ` +
        'data em que o LOCATÁRIO deverá devolver o imóvel livre e desocupado, salvo renovação por escrito.'),
      p('Findo o prazo sem oposição do LOCADOR e permanecendo o LOCATÁRIO no imóvel, a locação ' +
        'prorroga-se por prazo indeterminado, nas mesmas condições, podendo qualquer das partes ' +
        'encerrá-la mediante aviso por escrito com 30 (trinta) dias de antecedência.'),
    ].join('')),

    cl('DO ALUGUEL', [
      p(`O aluguel mensal é de <strong>${valor ? brl(valor) : LINHA}</strong>` +
        `${valor ? ` (${reaisExtenso(valor)})` : ''}, a ser pago até o dia ` +
        `<strong>${dia ? `${dia} (${numExtenso(dia)})` : LINHA}</strong> de cada mês` +
        `${partes.pagamento ? `, por meio de ${esc(partes.pagamento)}` : ', na forma combinada com o LOCADOR'}. ` +
        'O comprovante de pagamento vale como recibo.'),
      p(`O aluguel será reajustado a cada 12 (doze) meses pela variação acumulada do <strong>${indice}</strong> ` +
        'ou, na sua falta, pelo índice oficial que o substituir. Se a variação for negativa, o valor ' +
        'permanece o mesmo.'),
      p(`O atraso no pagamento sujeita o LOCATÁRIO a multa de ${multa}% (${numExtenso(multa)} por cento) ` +
        `sobre o valor devido, juros de ${juros}% ao mês e correção monetária, sem prejuízo da ação de ` +
        'despejo por falta de pagamento.'),
    ].join('')),

    cl('DOS ENCARGOS', p(`Além do aluguel, cabem ao LOCATÁRIO, durante toda a locação, ${esc(encargos)}. ` +
      'O LOCATÁRIO deverá apresentar os comprovantes de pagamento quando solicitado.')),

    cl('DA GARANTIA', p(clausulaGarantia(d))),

    cl('DA CONSERVAÇÃO DO IMÓVEL', [
      p('O LOCATÁRIO declara receber o imóvel em bom estado de conservação, limpeza e funcionamento' +
        (d.vistoria ? `, conforme a seguinte descrição: ${esc(d.vistoria)}` : '') +
        ', obrigando-se a devolvê-lo no mesmo estado, ressalvado o desgaste natural do uso normal.'),
      p('Cabem ao LOCATÁRIO os pequenos reparos decorrentes do uso (torneiras, lâmpadas, tomadas, ' +
        'fechaduras, vidros, entupimentos e similares) e a reparação de qualquer dano causado ao imóvel ' +
        'por ele, seus familiares, visitantes ou animais. Os reparos estruturais e os vícios anteriores ' +
        'à locação cabem ao LOCADOR, a quem o LOCATÁRIO deve comunicar de imediato qualquer problema.'),
      p('Nenhuma obra, reforma ou benfeitoria poderá ser feita sem autorização prévia e por escrito do ' +
        'LOCADOR. As benfeitorias feitas, mesmo autorizadas, incorporam-se ao imóvel sem direito a ' +
        'indenização ou retenção, salvo acordo escrito em contrário.'),
      p('O LOCADOR ou pessoa por ele indicada poderá vistoriar o imóvel, em dia e hora combinados ' +
        'previamente com o LOCATÁRIO.'),
    ].join('')),

    cl('DO USO E DA CONVIVÊNCIA', [
      p('O LOCATÁRIO usará o imóvel de forma pacífica, respeitando o sossego, a segurança e a saúde ' +
        'dos vizinhos, sendo responsável pelo comportamento de seus moradores e visitantes.' +
        (anexarRegras
          ? ' Por se tratar de casa situada em imóvel com outras casas e áreas comuns, o LOCATÁRIO ' +
            'declara conhecer e se obriga a cumprir o Regulamento Interno do Quintal (Anexo I), que ' +
            'faz parte deste contrato.'
          : '')),
      p(animais),
    ].join('')),

    cl('DA RESCISÃO', [
      p('Se o LOCATÁRIO devolver o imóvel antes do fim do prazo, pagará multa equivalente a ' +
        `${multaResc} (${numExtenso(multaResc)}) aluguéis vigentes, reduzida proporcionalmente ao tempo ` +
        'de contrato já cumprido (art. 4º da Lei 8.245/91), e deverá avisar o LOCADOR por escrito com ' +
        '30 (trinta) dias de antecedência.'),
      p('O descumprimento de qualquer cláusula deste contrato dá à parte prejudicada o direito de ' +
        'rescindi-lo, independentemente de aviso, e de exigir da outra parte a mesma multa acima, sem ' +
        'prejuízo das perdas e danos e da cobrança dos valores em aberto.'),
      p('Na saída, o LOCATÁRIO entregará as chaves mediante recibo, com o imóvel limpo, desocupado, ' +
        'com as contas de consumo quitadas até a data da entrega e após vistoria do LOCADOR.'),
    ].join('')),
  ];

  if (String(d.clausulas_extras || '').trim()) {
    corpo.push(cl('DAS CONDIÇÕES ESPECIAIS', String(d.clausulas_extras).trim().split(/\n\s*\n|\n/)
      .map((t) => p(esc(t.trim()))).join('')));
  }

  corpo.push(cl('DO FORO', p(`As partes elegem o foro da comarca de <strong>${esc(foro)}</strong> para ` +
    'resolver qualquer questão oriunda deste contrato, com renúncia a qualquer outro.')));

  corpo.push(p('E, por estarem assim justas e contratadas, as partes assinam este instrumento em 2 ' +
    '(duas) vias de igual teor e forma, na presença das testemunhas abaixo.'));

  corpo.push(`<p class="local-data">${esc(cidadeAss)}, ${dataExtenso(d.data_assinatura)}.</p>`);

  // assinaturas
  const props = (partes.proprietarios || []).filter(preenchida);
  const nomesProps = props.map((x) => esc(x.nome)).join(' e ');
  const ass = [];
  if (cfg.procuracao) {
    const proc = partes.procurador && partes.procurador.nome ? esc(partes.procurador.nome) : '';
    ass.push(assinatura('LOCADOR', proc
      ? `${nomesProps || 'Proprietário(s)'}<br>p.p. ${proc} (procurador)`
      : nomesProps));
  } else {
    (props.length ? props : [{}]).forEach((x) => ass.push(assinatura('LOCADOR', esc(x.nome || ''))));
  }
  ass.push(assinatura('LOCATÁRIO', esc(inq.nome || '')));
  if (d.garantia === 'fiador') ass.push(assinatura('FIADOR', ''));
  corpo.push(`<div class="assinaturas">${ass.join('')}</div>`);

  const t1 = d.testemunha1 || {}, t2 = d.testemunha2 || {};
  corpo.push('<p class="testemunhas-titulo"><strong>TESTEMUNHAS:</strong></p>' +
    `<div class="assinaturas">${testemunha(t1)}${testemunha(t2)}</div>`);

  if (anexarRegras) {
    corpo.push('<div class="anexo"><h2>ANEXO I — REGULAMENTO INTERNO DO QUINTAL</h2><ol>' +
      regras.map((r) => `<li><strong>${esc(r.titulo)}.</strong> ${esc(r.texto)}</li>`).join('') +
      '</ol><p>Ciente e de acordo:</p>' +
      `<div class="assinaturas">${assinatura('LOCATÁRIO', esc(inq.nome || ''))}</div></div>`);
  }

  return corpo.join('\n');
}

function assinatura(papel, nome) {
  return `<div class="ass"><div class="ass-linha"></div><div class="ass-nome">${nome || '&nbsp;'}</div>` +
    `<div class="ass-papel">${papel}</div></div>`;
}

function testemunha(t) {
  return `<div class="ass"><div class="ass-linha"></div>` +
    `<div class="ass-nome">${t.nome ? esc(t.nome) : 'Nome:'}</div>` +
    `<div class="ass-papel">CPF: ${t.cpf ? esc(t.cpf) : ''}</div></div>`;
}

// página completa (rota /contratos/:id/documento)
function pagina({ titulo, corpo }) {
  return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<style>
  @page{size:A4;margin:20mm 18mm}
  *{box-sizing:border-box}
  html{background:#e9ecef}
  body{margin:0;font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.5;color:#111}
  .barra{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    padding:10px 16px;background:#0b0f14;color:#e6edf3;font-family:system-ui,sans-serif;font-size:14px}
  .barra button,.barra a{font:inherit;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;
    text-decoration:none;background:#22c58b;color:#04110b;font-weight:700}
  .barra a{background:#2a3340;color:#e6edf3}
  .barra span{opacity:.75;flex:1;min-width:200px}
  .folha{max-width:210mm;margin:16px auto;background:#fff;padding:20mm 18mm;
    box-shadow:0 2px 14px rgba(0,0,0,.15);outline:none}
  h1{text-align:center;font-size:15pt;margin:0 0 18px;letter-spacing:.5px}
  h2{text-align:center;font-size:13pt;margin:0 0 14px}
  h3{font-size:12pt;margin:16px 0 6px}
  p{margin:0 0 8px;text-align:justify}
  ol{padding-left:22px}
  li{margin-bottom:6px;text-align:justify}
  .lacuna{white-space:nowrap}
  .local-data{text-align:right;margin:22px 0 10px}
  .assinaturas{display:flex;flex-wrap:wrap;gap:22px 40px;justify-content:space-between;margin:28px 0 8px}
  .ass{flex:1 1 45%;min-width:200px;text-align:center;break-inside:avoid}
  .ass-linha{border-top:1px solid #111;margin:30px 0 4px}
  .ass-nome{font-weight:bold;font-size:11pt}
  .ass-papel{font-size:10pt}
  .testemunhas-titulo{margin-top:22px}
  .anexo{break-before:page;page-break-before:always;margin-top:30px}
  @media screen and (max-width:700px){.folha{padding:18px 16px;margin:0}p,li{text-align:left}}
  @media print{
    html,body{background:#fff}
    .barra{display:none}
    .folha{box-shadow:none;margin:0;padding:0;max-width:none}
  }
</style></head>
<body>
<div class="barra">
  <a href="/contratos">← Contratos</a>
  <span>Dá para clicar no texto e ajustar antes de imprimir (o ajuste não fica salvo).</span>
  <button type="button" onclick="window.print()">🖨️ Imprimir / salvar PDF</button>
</div>
<div class="folha" contenteditable="true" spellcheck="false">
${corpo}
</div>
</body></html>`;
}

module.exports = { LOCAIS, INDICES, gerar, pagina, reaisExtenso, dataFim };
