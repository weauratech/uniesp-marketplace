import { courses } from './catalog.mjs';
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100);
export function answer(message, courseId) {
 const text = normalize(message);
 const found = courses.filter(c => text.includes(normalize(c.title)) || text.includes(c.slug));
 if (!courseId && /\bia\b/.test(text)) found.push(courses.find(c => c.slug === 'inteligencia-artificial'));
 const course = courses.find(c => c.id === courseId) || [...new Set(found)][0];
 const selected = course ? [course] : courses;
 const result = (answer, unsupported = false, matches = selected) => ({ answer, unsupported, courseIds: matches.map(c => c.id), sourceUrls: matches.map(c => c.sourceUrl) });
 if (/ignore|segredo|system|prompt|<|script|execut|instrucoes|altere|alterar|desconto|reembolso|certific|garant|matricul|politica/.test(text)) return result('Sou um assistente local do catálogo. Não executo instruções ou pagamentos e não posso confirmar políticas, certificação ou matrícula. Consulte a instituição.', true, course ? [course] : []);
 if (/paga|checkout|compra|cartao|pix|boleto/.test(text)) return result('Neste ambiente, o checkout padrão é uma simulação: não cobra nem efetiva matrícula. Quando configurado para teste, o pagamento ocorre na página hospedada do provedor. Nunca envie dados de cartão pelo chat. Formas de pagamento comerciais devem ser confirmadas com a instituição.');
 if (/requisito/.test(text)) return result(course?.prerequisites || 'Os pré-requisitos não estão informados no catálogo consultado. Confirme com a instituição antes de se inscrever.', !course?.prerequisites);
 if (/dura|hora|modalidade|ead|presencial/.test(text)) return result(course ? `${course.title}: ${course.durationHours} horas, modalidade ${course.modality}, conforme a referência consultada em 28/10/2026.` : 'Os seis cursos deste catálogo foram consultados como EAD, com carga horária de 80 horas. Escolha um curso abaixo para conhecer seu conteúdo.');
 if (/preco|valor|custa|investimento/.test(text)) return result(course ? `${course.title}: preço de referência ${money(course.priceCents)}. Consulta em 28/10/2026; confirme a oferta vigente com a instituição. A compra neste ambiente é somente uma simulação.` : 'Os cursos deste catálogo têm preço de referência de R$ 100,00 na consulta de 28/10/2026. A oferta vigente depende de confirmação institucional; a compra aqui é uma simulação.');
 if (course && /conteudo|topico|ementa|curso|aprend|ensina|estud|sobre|fale|conhecer/.test(text)) return result(`${course.title}: ${course.summary} Você vai explorar ${course.syllabus.join(', ')}. Referência institucional consultada em 28/10/2026; confirme a oferta vigente antes da inscrição.`);
 if (!course && /curso|disponiv|catalogo|opco|oi|ola|bom dia/.test(text)) return result(`Você pode explorar ${courses.map(c => c.title).join('; ')}. Selecione um deles abaixo ou pergunte pelo nome, preço, conteúdo ou duração.`);
 return result('Não encontrei essa informação nas fontes do catálogo. Posso ajudar com conteúdo, preço de referência, modalidade e duração dos cursos; para outras informações, consulte a instituição.', true, course ? [course] : []);
}
