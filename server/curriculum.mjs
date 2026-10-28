// Editorial grouping of documented topics; no official distribution of hours exists.
export function curriculumFor(course) {
 return {label:'adaptação demonstrativa',sources:course.sources || [{url:course.sourceUrl,label:'Snapshot institucional 28/10/2026',kind:'official'}],modules:course.topics.map((topic,i)=>({id:`${course.id}-module-${i+1}`,title:topic,topics:[topic],hours:null}))};
}
