export type Source={label:string;url:string;kind:'official'|'demo'};
export type Course={id:string;slug:string;category:string;title:string;summary:string;description:string;syllabus:string[];modality:string|null;durationHours:number|null;prerequisites:string|null;imageUrl:string;imageAlt:string;priceCents:number;priceLabel:string;available:boolean;sources:Source[];detailsLabel:string;curriculum?:Curriculum;cohorts?:Cohort[]};
export type Cart={items:{course:Course;quantity:1;subtotalCents:number}[];totalCents:number;revision:number};
export type Order={id:string;items:{courseId:string;title:string;unitPriceCents:number}[];totalCents:number;status:'pending'|'simulated_paid'|'paid'|'cancelled'|'expired';paymentMode:'demo'|'disabled'|'test';createdAt:string};
export type Payment={mode:'demo'|'disabled'|'test';checkoutEnabled:boolean;reason:string|null};
export type Answer={answer:string;sources:Source[];courseIds:string[];unsupported:boolean};
let csrf='';
export async function request<T>(path:string,method='GET',body?:unknown,key?:string):Promise<T>{
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
 const result=await response.json();if(!response.ok){const messages:Record<string,string>={CART_CHANGED:'Seu carrinho foi atualizado. Confira os cursos e valores antes de continuar.',SESSION_REQUIRED:'Sua sessão expirou. Atualize os dados para começar uma nova sessão.',CSRF_INVALID:'Atualize os dados da página e tente novamente.',RATE_LIMITED:'Muitas solicitações em pouco tempo. Aguarde um minuto e tente novamente.',PAYMENT_UNAVAILABLE:'O checkout de teste está temporariamente indisponível. Tente novamente.',PAYMENT_DISABLED:'O checkout de teste está indisponível neste ambiente.',ORDER_TERMINAL:'Este pedido já foi concluído. Confira seu status em Meus pedidos.'};throw new Error(messages[result.error?.code]||result.error?.message||'Não foi possível concluir. Tente novamente.');}return result;
}
export async function session(){const data=await request<{csrfToken:string;payment:Payment;pendingCartAvailable?:boolean}>('/session');csrf=data.csrfToken;return data;}
export const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export function safeLink(url:string){return /^\/(?!\/)/.test(url)||/^https:\/\/www\.iesp\.edu\.br\//.test(url)?url:undefined;}
export type Curriculum={label:string;sources:Source[];modules:{id:string;title:string;topics:string[];hours:number|null}[]};
export type Meeting={id?:string;startsAt:string;endsAt:string;roomId:string;teacherId:string};
export type Cohort={id:string;courseId:string;title:string;version:number;status:string;capacity:number;availableSeats:number;modality:'ead'|'presencial';teacherIds:string[];meetings:Meeting[];completionRule:{minimumGrade:number|null;minimumAttendancePercent:number|null}};
export type User={id:string;displayName:string;email:string;emailVerified:boolean;roles:string[]};
export type Enrollment={curriculum?:Curriculum;meetings?:Meeting[];cohortTitle?:string;modality?:string;id:string;courseId:string;cohortId:string;status:string;grade:number|null;attendancePercent:number|null;teacherComment:string|null;certificateEligible:boolean;progress:{completedModuleIds:string[];totalModules:number}};
export type Certificate={id:string;label:string;downloadUrl:string;verificationUrl:string};
export const dateTime=(s:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(new Date(s));
