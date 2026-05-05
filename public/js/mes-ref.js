// Helpers compartilhados para o "mês de referência" persistente entre páginas.
// Fonte da verdade: querystring (?ano=&mes=) > localStorage > hoje.
// Sempre clamp pra >= INICIO (abril/2026).

window.NOMES_MES = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

window.getMesRef = function() {
  const q = new URLSearchParams(location.search);
  let ano = parseInt(q.get('ano'), 10);
  let mes = parseInt(q.get('mes'), 10);
  if (!ano || !mes) {
    ano = parseInt(localStorage.getItem('mes_ref_ano'), 10);
    mes = parseInt(localStorage.getItem('mes_ref_mes'), 10);
  }
  if (!ano || !mes) {
    const h = new Date();
    ano = h.getFullYear();
    mes = h.getMonth() + 1;
  }
  if (ano < 2026 || (ano === 2026 && mes < 4)) {
    ano = 2026;
    mes = 4;
  }
  return { ano, mes };
};

window.setMesRef = function(ano, mes) {
  localStorage.setItem('mes_ref_ano', String(ano));
  localStorage.setItem('mes_ref_mes', String(mes));
};

window.preencherOpcoesMes = function(selectEl, ano) {
  const min = (ano === 2026) ? 4 : 1;
  selectEl.innerHTML = '';
  for (let m = min; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = NOMES_MES[m];
    selectEl.appendChild(o);
  }
};
