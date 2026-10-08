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

// "1 (uma) pessoa", "2 (duas) pessoas", "21 (vinte e uma) pessoas"
function pessoas(q) {
  const ext = numExtenso(q).replace(/\bum$/, 'uma').replace(/\bdois$/, 'duas');
  return `${q} (${ext}) ${q === 1 ? 'pessoa' : 'pessoas'}`;
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
  const rotulo = `LOCADOR${plural ? 'ES' : ''}`;
  if (!LOCAIS[local].procuracao) return quadroParte('locador', rotulo, `${quals}.`);
  return quadroParte('locador', rotulo, `${quals}; ` +
    `${plural ? 'neste ato representados' : 'neste ato representado(a)'} por seu procurador ` +
    `${qualificacao(partes.procurador)}, nos termos da procuração ${v(partes.procuracao)}, ` +
    'cuja cópia integra este contrato.');
}

// quadro colorido de uma parte (locador / locatário) no topo do contrato
function quadroParte(tipo, rotulo, texto) {
  return `<div class="parte parte-${tipo}"><div class="parte-rotulo">${rotulo}</div><p>${texto}</p></div>`;
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

  const visitaDias = Number(d.visita_dias) || 14;
  const qtdMoradores = Number(d.moradores_qtd) || 0;
  const rateio = local === 'diadema';

  let n = 0;
  const cl = (titulo, corpo) => `<section class="clausula"><h3><span class="cl-num">CLÁUSULA ${++n}ª</span>` +
    `<span class="cl-titulo">${titulo}</span></h3>${corpo}</section>`;
  const p = (t) => `<p>${t}</p>`;
  // parágrafos numerados dentro da cláusula: "Parágrafo 1º —"
  const pars = (lista) => lista.map((t, i) => (i === 0 ? p(t) : `<p class="par"><span class="par-num">§ ${i}º</span> ${t}</p>`)).join('');

  const ocupantes = String(d.ocupantes || '').trim();
  const animais = d.animais === 'autorizado'
    ? [`Como exceção expressa, fica autorizada somente a permanência de: ${v(d.animais_desc)}. Nenhum outro ` +
        'animal poderá ser mantido no imóvel, nem substituir o autorizado.',
      'O LOCATÁRIO responde integralmente por qualquer dano, sujeira, odor, barulho ou incômodo causado pelo ' +
        'animal, que deverá ficar sempre dentro da casa ou na coleira, e a autorização poderá ser revogada ' +
        'pelo LOCADOR a qualquer tempo se as regras de convivência forem descumpridas, devendo o animal ser ' +
        'retirado em até 7 (sete) dias após o aviso.']
    : ['É <strong>expressamente proibido</strong> criar, manter, hospedar ou abrigar animais de qualquer espécie ' +
        'ou porte no imóvel e nas áreas comuns, ainda que temporariamente, "por alguns dias" ou pertencentes a ' +
        'visitantes.',
      'Constatada a presença de animal, o LOCATÁRIO será avisado e deverá retirá-lo em até 48 (quarenta e oito) ' +
        'horas. Não retirado no prazo, ficará caracterizada infração contratual grave, sujeita à multa e à ' +
        'rescisão previstas neste contrato, além do pagamento de qualquer dano, limpeza ou dedetização necessária.'];

  const corpo = [
    '<header class="topo"><h1>CONTRATO DE LOCAÇÃO RESIDENCIAL</h1>' +
      `<div class="topo-sub">${esc(imovelDesc || 'Imóvel')} · ${esc(cfg.nome)} · Lei nº 8.245/91</div></header>`,
    blocoLocador(local, partes),
    quadroParte('locatario', 'LOCATÁRIO', `${qualificacao(inq, { endereco: false })}` +
      `${inq.telefone ? `, telefone ${esc(inq.telefone)}` : ''}` +
      `${inq.email ? `, e-mail ${esc(inq.email)}` : ''}.`),
    p('As partes acima identificadas têm entre si, justo e contratado, a locação do imóvel descrito ' +
      'abaixo, que se regerá pela Lei nº 8.245/91 e pelas cláusulas seguintes, que as partes leram e aceitam.'),

    cl('DO OBJETO E DOS MORADORES', pars([
      `O LOCADOR dá em locação ao LOCATÁRIO o imóvel residencial <strong>${v(imovelDesc)}</strong>, ` +
        `situado em ${v(partes.endereco_imovel)}${d.imovel_complemento ? `, ${esc(d.imovel_complemento)}` : ''}.`,
      `O imóvel será ocupado por <strong>${qtdMoradores ? pessoas(qtdMoradores) : `${LINHA} pessoa(s)`}` +
        `</strong>: o LOCATÁRIO${ocupantes ? ` e ${esc(ocupantes)}` : ''}. A entrada de qualquer novo ` +
        'morador depende de autorização prévia e por escrito do LOCADOR.',
      'É vedado sublocar, ceder, emprestar ou transferir o imóvel, no todo ou em parte, a qualquer título, ' +
        'inclusive por aplicativos de hospedagem, sem consentimento prévio e por escrito do LOCADOR.',
    ])),

    cl('DA FINALIDADE — USO EXCLUSIVAMENTE RESIDENCIAL', pars([
      'O imóvel destina-se <strong>exclusivamente à moradia</strong> do LOCATÁRIO e dos moradores declarados, ' +
        'sendo <strong>proibido qualquer uso comercial</strong>, industrial ou profissional.',
      'Ficam proibidos, entre outros: comércio ou venda de produtos no local; bar, lanchonete, oficina, salão, ' +
        'ateliê ou qualquer atendimento ao público; depósito ou estoque de mercadorias; uso do endereço do ' +
        'imóvel para registro de empresa, CNPJ ou MEI; e hospedagem remunerada de terceiros.',
      'Também é proibido guardar no imóvel materiais inflamáveis, explosivos, tóxicos ou ilícitos (salvo o ' +
        'botijão de gás de uso doméstico) e praticar no local qualquer atividade ilegal.',
      'O descumprimento desta cláusula é infração grave e autoriza a rescisão imediata do contrato, com a ' +
        'aplicação da multa prevista na cláusula de infrações.',
    ])),

    cl('DO PRAZO', pars([
      `A locação tem prazo de <strong>${prazo ? `${prazo} (${numExtenso(prazo)}) meses` : LINHA}</strong>, ` +
        `com início em <strong>${dataBR(d.inicio)}</strong> e término em <strong>${fim ? dataBR(fim) : LINHA}</strong>, ` +
        'data em que o LOCATÁRIO deverá devolver o imóvel livre e desocupado, independentemente de aviso, ' +
        'salvo renovação por escrito.',
      'Findo o prazo e permanecendo o LOCATÁRIO no imóvel sem oposição do LOCADOR, a locação prorroga-se por ' +
        'prazo indeterminado, nas mesmas condições, podendo ser encerrada pelo LOCADOR nas hipóteses da lei ' +
        'e pelo LOCATÁRIO mediante aviso por escrito com 30 (trinta) dias de antecedência.',
    ])),

    cl('DO ALUGUEL E DO PAGAMENTO', pars([
      `O aluguel mensal é de <strong>${valor ? brl(valor) : LINHA}</strong>` +
        `${valor ? ` (${reaisExtenso(valor)})` : ''}, a ser pago até o dia ` +
        `<strong>${dia ? `${dia} (${numExtenso(dia)})` : LINHA}</strong> de cada mês` +
        `${partes.pagamento ? `, por meio de ${esc(partes.pagamento)}` : ', na forma indicada pelo LOCADOR'}. ` +
        'O comprovante de transferência vale como recibo. Pagamento feito de outra forma ou a outra pessoa ' +
        'não terá validade.',
      `O aluguel será reajustado a cada 12 (doze) meses pela variação acumulada do <strong>${indice}</strong> ` +
        'ou, na sua falta, pelo índice oficial que o substituir. Se a variação for negativa, o valor ' +
        'permanece o mesmo.',
      'O LOCATÁRIO não poderá descontar do aluguel nenhuma despesa, conserto ou compra, salvo autorização ' +
        'prévia e por escrito do LOCADOR. O pagamento parcial não quita o mês e pode ser recusado.',
    ])),

    cl('DO ATRASO NO PAGAMENTO', pars([
      'O não pagamento do aluguel ou dos encargos até o vencimento sujeita o LOCATÁRIO, automaticamente e ' +
        `independentemente de aviso, a: (a) <strong>multa de ${multa}% (${numExtenso(multa)} por cento)</strong> ` +
        `sobre o valor devido; (b) <strong>juros de ${juros}% (${numExtenso(juros)} por cento) ao mês</strong>, ` +
        'calculados dia a dia; e (c) correção monetária pelo índice de reajuste deste contrato.',
      'Se a cobrança for feita por advogado, o LOCATÁRIO pagará também os honorários advocatícios de 10% ' +
        '(dez por cento) sobre o débito na cobrança extrajudicial e de 20% (vinte por cento) na judicial, ' +
        'além das custas e despesas do processo.',
      'O atraso de qualquer aluguel ou encargo por mais de 30 (trinta) dias, ou o atraso repetido por 3 ' +
        '(três) meses, seguidos ou não, dentro de 12 (doze) meses, é infração grave e autoriza a rescisão do ' +
        'contrato e a ação de despejo por falta de pagamento, além da cobrança de todo o débito.',
      'O débito vencido e não pago poderá ser levado a protesto e a registro nos órgãos de proteção ao ' +
        'crédito (SPC/Serasa), após comunicação ao LOCATÁRIO.',
      'O recebimento de um aluguel com atraso, ou sem os acréscimos, por mera tolerância do LOCADOR, não ' +
        'altera o vencimento nem dispensa a cobrança da multa e dos juros em outros meses.',
    ])),

    cl('DOS ENCARGOS E CONTAS DE CONSUMO', pars([
      `Além do aluguel, cabem ao LOCATÁRIO, durante toda a locação, ${esc(encargos)}.`,
      'As contas e encargos em atraso sofrem os mesmos acréscimos do aluguel (multa, juros, correção e ' +
        'honorários). Se o LOCADOR pagar alguma conta que caberia ao LOCATÁRIO, o valor será reembolsado no ' +
        'vencimento do aluguel seguinte, com os mesmos acréscimos.',
      'O LOCATÁRIO deverá apresentar os comprovantes de pagamento sempre que solicitado e entregar o imóvel ' +
        'com todas as contas quitadas até a data da entrega das chaves.',
    ])),

    cl('DAS VISITAS', pars([
      'Visitas são permitidas, sob a inteira responsabilidade do LOCATÁRIO, que responde pelo comportamento ' +
        'delas e por qualquer dano que causarem ao imóvel, às áreas comuns ou aos vizinhos.',
      `A pessoa que permanecer no imóvel por mais de <strong>${visitaDias} (${numExtenso(visitaDias)}) dias</strong>, ` +
        'seguidos ou somados dentro do mesmo mês, deixa de ser considerada visita e passa a ser considerada ' +
        'morador para todos os efeitos deste contrato' +
        (rateio
          ? ', <strong>entrando na divisão das contas rateadas por morador, como a de água</strong>, a ' +
            'partir do mês em que o prazo for ultrapassado'
          : '') + '.',
      'O LOCATÁRIO é obrigado a informar ao LOCADOR a permanência de visita por mais tempo que o previsto ' +
        'acima. A permanência não informada, além de contar como morador desde o primeiro dia, é infração ' +
        'contratual. A visita que se tornar morador continua dependendo da autorização prevista na cláusula 1ª.',
    ])),

    cl('DOS ANIMAIS', pars(animais)),

    cl('DA GARANTIA', p(clausulaGarantia(d))),

    cl('DA CONSERVAÇÃO E DAS OBRAS', pars([
      'O LOCATÁRIO declara ter vistoriado e receber o imóvel em bom estado de conservação, limpeza e ' +
        'funcionamento' + (d.vistoria ? `, conforme a seguinte descrição: ${esc(d.vistoria)}` : '') +
        ', obrigando-se a devolvê-lo no mesmo estado, ressalvado o desgaste natural do uso normal.',
      'Cabem ao LOCATÁRIO os pequenos reparos decorrentes do uso (torneiras, lâmpadas, tomadas, ' +
        'fechaduras, vidros, entupimentos e similares) e a reparação de qualquer dano causado ao imóvel por ' +
        'ele, seus moradores ou visitantes. Os reparos estruturais e os vícios anteriores à locação cabem ao ' +
        'LOCADOR, a quem o LOCATÁRIO deve comunicar de imediato qualquer problema.',
      'Nenhuma obra, reforma, pintura em cor diferente, furo em azulejo, troca de fechadura ou instalação ' +
        'elétrica ou hidráulica poderá ser feita sem autorização prévia e por escrito do LOCADOR. As ' +
        'benfeitorias feitas, ainda que autorizadas e mesmo as necessárias, incorporam-se ao imóvel sem direito ' +
        'a indenização ou retenção (art. 35 da Lei 8.245/91).',
      'É proibido puxar energia ou água de outra casa ou fazer ligação improvisada. O LOCADOR ou pessoa por ' +
        'ele indicada poderá vistoriar o imóvel em dia e hora combinados com o LOCATÁRIO, ou a qualquer hora em ' +
        'caso de emergência (vazamento, curto-circuito, risco à segurança).',
    ])),

    cl('DO USO E DA CONVIVÊNCIA', p('O LOCATÁRIO usará o imóvel de forma pacífica, respeitando o sossego, ' +
      'a segurança e a saúde dos vizinhos, sendo responsável pelo comportamento de seus moradores e visitantes.' +
      (anexarRegras
        ? ' Por se tratar de casa situada em imóvel com outras casas e áreas comuns, o LOCATÁRIO declara ' +
          'conhecer e se obriga a cumprir o Regulamento Interno do Quintal (Anexo I), que faz parte deste ' +
          'contrato. O descumprimento repetido do regulamento, após aviso, é infração contratual.'
        : ''))),

    cl('DAS INFRAÇÕES E DA RESCISÃO', pars([
      'O descumprimento de qualquer cláusula deste contrato sujeita a parte infratora à multa de ' +
        `<strong>${multaResc} (${numExtenso(multaResc)}) aluguéis vigentes</strong> e dá à outra parte o ` +
        'direito de rescindi-lo, sem prejuízo da cobrança das perdas e danos e dos valores em aberto. A ' +
        'multa é devida por inteiro, qualquer que seja o tempo decorrido do contrato.',
      'São infrações graves, entre outras: atraso de pagamento nos termos da cláusula de atraso; uso ' +
        'comercial do imóvel; sublocação ou cessão; animais sem autorização; morador não autorizado; obras ' +
        'sem autorização; e prática de atividade ilegal no imóvel.',
      'Se o LOCATÁRIO devolver o imóvel antes do fim do prazo, pagará a multa acima reduzida ' +
        'proporcionalmente ao tempo de contrato que falta cumprir (art. 4º da Lei 8.245/91), e deverá avisar o ' +
        'LOCADOR por escrito com 30 (trinta) dias de antecedência; sem o aviso, pagará também 1 (um) aluguel.',
    ])),

    cl('DA DEVOLUÇÃO DO IMÓVEL', pars([
      'A devolução só se considera feita com a entrega das chaves ao LOCADOR mediante recibo escrito, após ' +
        'vistoria de saída. Até essa data são devidos o aluguel e os encargos, proporcionais aos dias.',
      'O imóvel deve ser devolvido limpo, desocupado, com as contas quitadas e no estado da vistoria de ' +
        'entrada. Os danos encontrados serão cobrados pelo valor do orçamento do conserto, e o aluguel continua ' +
        'correndo durante o tempo necessário para os reparos causados pelo LOCATÁRIO.',
      'Objetos deixados no imóvel depois da entrega das chaves ou do abandono serão considerados ' +
        'abandonados após 30 (trinta) dias, podendo o LOCADOR dar-lhes o destino que entender.',
    ])),

    cl('DAS DISPOSIÇÕES GERAIS', pars([
      'Avisos e notificações entre as partes podem ser feitos por escrito, inclusive por WhatsApp ou e-mail ' +
        'nos contatos informados neste contrato, valendo como recebidos na data do envio. O LOCATÁRIO deve ' +
        'informar qualquer mudança de telefone ou e-mail.',
      'A tolerância de qualquer das partes com o descumprimento de alguma cláusula não significa renúncia, ' +
        'perdão ou mudança do contrato, podendo a cláusula ser exigida a qualquer tempo.',
      'O LOCATÁRIO responde por todas as obrigações deste contrato, inclusive pelos atos dos demais ' +
        'moradores e visitantes. O LOCATÁRIO autoriza o uso dos seus dados pessoais pelo LOCADOR exclusivamente para a gestão desta ' +
        'locação e a cobrança de valores devidos.',
    ])),
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
  corpo.push(`<h3 class="secao-ass">ASSINATURAS</h3><div class="assinaturas">${ass.join('')}</div>`);

  const t1 = d.testemunha1 || {}, t2 = d.testemunha2 || {};
  corpo.push('<h3 class="secao-ass">TESTEMUNHAS</h3>' +
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
  /* cores: azul = locador, verde = locatário, vinho = cláusulas */
  .folha{--azul:#1d4e89;--azul-bg:#eef4fb;--verde:#1f7a4d;--verde-bg:#edf7f1;--cor:#7a1f2b;--cor-bg:#f8eef0}
  .topo{text-align:center;border-bottom:3px double var(--cor);padding-bottom:10px;margin-bottom:18px}
  h1{font-size:16pt;margin:0;letter-spacing:1px;color:var(--cor)}
  .topo-sub{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#555;letter-spacing:.5px;margin-top:4px}
  h2{text-align:center;font-size:13pt;margin:0 0 14px;color:var(--cor)}
  p{margin:0 0 8px;text-align:justify}
  strong{color:#000}
  .parte{border:1px solid;border-left-width:6px;border-radius:6px;padding:10px 14px 4px;margin:0 0 12px;break-inside:avoid}
  .parte-rotulo{display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:9pt;font-weight:700;
    letter-spacing:1.5px;color:#fff;padding:2px 10px;border-radius:3px;margin-bottom:6px}
  .parte-locador{border-color:var(--azul);background:var(--azul-bg)}
  .parte-locador .parte-rotulo{background:var(--azul)}
  .parte-locador strong{color:var(--azul)}
  .parte-locatario{border-color:var(--verde);background:var(--verde-bg)}
  .parte-locatario .parte-rotulo{background:var(--verde)}
  .parte-locatario strong{color:var(--verde)}
  .clausula{margin-top:16px}
  h3{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:11.5pt;margin:0 0 8px;
    padding:5px 10px;background:var(--cor-bg);border-left:5px solid var(--cor);border-radius:0 4px 4px 0;
    break-after:avoid;page-break-after:avoid}
  .cl-num{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;font-weight:700;color:#fff;background:var(--cor);
    padding:1px 8px;border-radius:3px;letter-spacing:.5px;white-space:nowrap}
  .cl-titulo{color:var(--cor);letter-spacing:.3px}
  .par-num{font-weight:700;color:var(--cor)}
  .secao-ass{margin-top:26px}
  ol{padding-left:22px}
  li{margin-bottom:6px;text-align:justify}
  li::marker{color:var(--cor);font-weight:700}
  .lacuna{white-space:nowrap}
  .local-data{text-align:right;margin:22px 0 10px}
  .assinaturas{display:flex;flex-wrap:wrap;gap:22px 40px;justify-content:space-between;margin:14px 0 8px}
  .ass{flex:1 1 45%;min-width:200px;text-align:center;break-inside:avoid}
  .ass-linha{border-top:1px solid #111;margin:34px 0 4px}
  .ass-nome{font-weight:bold;font-size:11pt}
  .ass-papel{font-family:Arial,Helvetica,sans-serif;font-size:8.5pt;letter-spacing:1px;color:var(--cor);font-weight:700}
  .anexo{break-before:page;page-break-before:always;margin-top:30px}
  @media screen and (max-width:700px){.folha{padding:18px 16px;margin:0}p,li{text-align:left}}
  @media print{
    html,body{background:#fff}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
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
