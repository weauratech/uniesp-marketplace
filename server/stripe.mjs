import Stripe from 'stripe';
import {secretFile} from './auth.mjs';
export function stripeAdapter({secret=process.env.STRIPE_SECRET_KEY_FILE?secretFile('STRIPE_SECRET_KEY'):undefined,webhookSecret=process.env.STRIPE_WEBHOOK_SECRET_FILE?secretFile('STRIPE_WEBHOOK_SECRET'):undefined,origin,client}={}){
 if(!/^(sk|rk)_test_/.test(secret||''))throw new Error('Only Stripe test secret keys accepted');
 if(!webhookSecret?.startsWith('whsec_'))throw new Error('Webhook signing secret required');
 const stripe=client||new Stripe(secret,{timeout:5000,maxNetworkRetries:0});
 return {
 async createCheckout(order,attemptId){const s=await stripe.checkout.sessions.create({mode:'payment',client_reference_id:order.id,metadata:{orderId:order.id,attemptId},line_items:order.items.map(i=>({quantity:1,price_data:{currency:'brl',unit_amount:i.unitPriceCents,product_data:{name:i.title}}})),success_url:`${origin}/checkout/retorno?orderId=${order.id}`,cancel_url:`${origin}/checkout/retorno?orderId=${order.id}&cancelled=1`},{idempotencyKey:attemptId});const u=new URL(s.url);if(s.livemode!==false||!s.id.startsWith('cs_test_')||u.protocol!=='https:'||u.hostname!=='checkout.stripe.com')throw new Error('Invalid test checkout');return {providerSessionId:s.id,url:s.url,expiresAt:new Date(s.expires_at*1000).toISOString()};},
 verifyWebhook(raw,headers){const e=stripe.webhooks.constructEvent(raw,headers['stripe-signature'],webhookSecret,300);if(e.livemode!==false||e.account)throw new Error('Live event rejected');return e;},
 async expireCheckout(id,key){return stripe.checkout.sessions.expire(id,{}, {idempotencyKey:key});},
 async fetchPayment(event){return stripe.checkout.sessions.retrieve(event.data.object.id);},
 valid(s,order,attempt){return s.livemode===false&&s.id===attempt.sessionId&&s.id.startsWith('cs_test_')&&s.mode==='payment'&&s.status==='complete'&&s.payment_status==='paid'&&s.client_reference_id===order.id&&s.metadata?.orderId===order.id&&s.metadata?.attemptId===attempt.id&&s.amount_total===order.totalCents&&s.currency==='brl'&&typeof s.payment_intent==='string';}
 };
}
