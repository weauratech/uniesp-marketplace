const rows = [
['inteligencia-artificial','Inteligência Artificial','Fundamentos e aplicações de sistemas inteligentes.',['Aprendizado de máquina','Redes neurais','Algoritmos genéticos','Processamento de linguagem natural']],
['cybersecurity','Cybersecurity','Conceitos para compreender riscos e proteger informações digitais.',['Phishing e malware','Proteção de redes','Políticas de segurança','Resposta a incidentes']],
['marketing-digital-e-novas-midias','Marketing Digital e Novas Mídias','Estratégias de comunicação e campanhas nos canais digitais.',['Redes sociais','Busca e publicidade','Criação de conteúdo','Métricas de campanhas']],
['digital-design','Digital Design','Princípios de criação visual aplicados ao ambiente digital.',['Design gráfico','Tipografia','Composição visual','Teoria das cores']],
['lideranca-e-formacao-de-equipes','Liderança e Formação de Equipes','Comunicação e colaboração para desenvolver equipes.',['Comunicação','Tomada de decisões','Resolução de conflitos','Diversidade e colaboração']],
['gestao-de-negocios-digitais-e-comercio-eletronico','Gestão de Negócios Digitais e Comércio Eletrônico','Conceitos de operação e estratégia para negócios online.',['Comércio eletrônico','Presença online','Operações de vendas','Atração e retenção de clientes']]
];
export const courses = rows.map(([id,title,summary,topics])=>({id,title,summary,topics,priceCents:10000,currency:'BRL',durationHours:80,modality:'EAD',prerequisites:'Não informado na fonte consultada.',sourceUrl:`https://www.iesp.edu.br/cursos/cursos-livres/${id}`,sourceCheckedAt:'2026-10-28',notice:'Snapshot informativo; oferta e matrícula dependem de confirmação institucional.'}));
for (const c of courses) Object.assign(c,{slug:c.id,description:c.summary,syllabus:c.topics,prerequisites:null,imageUrl:'/assets/tecnologia.svg',imageAlt:'Placeholder de estudo remoto',available:true,priceLabel:'snapshot_oficial',observedAt:'2026-10-28T00:00:00.000Z',detailsLabel:'institucional',sources:[{label:'Página institucional — snapshot 28/10/2026',url:c.sourceUrl,kind:'official'}]});

for (const c of courses) c.category = ['inteligencia-artificial','cybersecurity','digital-design'].includes(c.id)?'Tecnologia e criação':'Negócios e gestão';

for (const c of courses) if(['marketing-digital-e-novas-midias','lideranca-e-formacao-de-equipes'].includes(c.id))Object.assign(c,{imageUrl:'/assets/estudantes.svg',imageAlt:'Placeholder de aprendizagem'});
