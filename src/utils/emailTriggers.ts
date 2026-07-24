import { db } from '../firebase';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';

interface EmailTemplateData {
  subject: string;
  body: string;
}

// Helper to fetch template or provide static defaults
async function getTemplateOrFallback(templateId: string, fallbackSubject: string, fallbackBody: string): Promise<EmailTemplateData> {
  try {
    const snap = await getDoc(doc(db, 'email_templates', templateId));
    if (snap.exists()) {
      const data = snap.data();
      return {
        subject: data.subject || fallbackSubject,
        body: data.body || fallbackBody
      };
    }
  } catch (err) {
    console.warn(`[Email Trigger] Failed to query template "${templateId}", using hardcoded fallback.`, err);
  }
  return { subject: fallbackSubject, body: fallbackBody };
}

// General enqueuer
async function enqueueEmail(userId: string | null, recipient: string, subject: string, message: string) {
  try {
    const queueId = `trig-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
    await addDoc(collection(db, 'email_queue'), {
      id: queueId,
      recipient,
      subject,
      message,
      status: 'pending',
      userId,
      createdAt: new Date().toISOString()
    });
    console.log(`[Email Trigger] Successfully queued email to ${recipient}: "${subject}"`);
  } catch (err) {
    console.error(`[Email Trigger] Critical error enqueuing email to ${recipient}:`, err);
  }
}

/**
 * 1. Welcome Email (Triggered on Signup)
 */
export async function triggerWelcomeEmail(userId: string, email: string, name: string) {
  const fallbackSub = 'Welcome To ATFunding';
  const fallbackBody = `Welcome to ATFunding.\n\nYour account has been created successfully.\n\nPlease verify your email address to activate your account.`;
  
  const temp = await getTemplateOrFallback('welcome', fallbackSub, fallbackBody);
  const body = temp.body.replace(/{Name}/g, name || 'Trader');
  
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 2. Purchase Received Email
 */
export async function triggerPurchaseEmail(userId: string, email: string, name: string, accountType: string, accountSize: string) {
  const fallbackSub = 'ATFunding Purchase Received';
  const fallbackBody = `Hello {Name}\n\nWe have received your purchase.\n\nAccount Type:\n{Account Type}\n\nAccount Size:\n{Account Size}\n\nStatus:\nPENDING APPROVAL\n\nOur team will review your payment shortly.`;
  
  const temp = await getTemplateOrFallback('purchase', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Account Type}/g, accountType.replace('_', ' ').toUpperCase())
    .replace(/{Account Size}/g, accountSize);
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 3. Account Approved Email
 */
export async function triggerApprovedEmail(userId: string, email: string, name: string, accountType: string, accountSize: string) {
  const fallbackSub = 'Your ATFunding Account Is Active';
  const fallbackBody = `Congratulations {Name}.\n\nYour account has been approved.\n\nAccount Type:\n{Account Type}\n\nAccount Size:\n{Account Size}\n\nStatus:\nACTIVE\n\nLogin to your dashboard to view account details.`;
  
  const temp = await getTemplateOrFallback('approved', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Account Type}/g, accountType.replace('_', ' ').toUpperCase())
    .replace(/{Account Size}/g, accountSize);
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 4. Account Purchase Rejected Email
 */
export async function triggerRejectedEmail(userId: string, email: string, name: string, adminReason: string) {
  const fallbackSub = 'Account Purchase Rejected';
  const fallbackBody = `Hello {Name},\n\nYour purchase could not be approved.\n\nReason:\n{Admin Reason}\n\nPlease contact support if required.`;
  
  const temp = await getTemplateOrFallback('rejected', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Admin Reason}/g, adminReason || 'Transaction hash could not be verified on-chain.');
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 5. KYC Approved Email
 */
export async function triggerKycApprovedEmail(userId: string, email: string, name: string) {
  const fallbackSub = 'KYC Approved';
  const fallbackBody = `Hello {Name},\n\nYour identity verification has been approved.\n\nYou can now request payouts.`;
  
  const temp = await getTemplateOrFallback('kyc_approved', fallbackSub, fallbackBody);
  const body = temp.body.replace(/{Name}/g, name || 'Trader');
  
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 6. KYC Rejected Email
 */
export async function triggerKycRejectedEmail(userId: string, email: string, name: string, adminReason: string) {
  const fallbackSub = 'KYC Rejected';
  const fallbackBody = `Hello {Name},\n\nYour KYC submission requires correction.\n\nReason:\n{Admin Reason}\n\nPlease upload new documents.`;
  
  const temp = await getTemplateOrFallback('kyc_rejected', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Admin Reason}/g, adminReason || 'Document files are dark/blurry or expired.');
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 7. Payout Request Received Email
 */
export async function triggerPayoutReceivedEmail(userId: string, email: string, name: string, amount: string) {
  const fallbackSub = 'Payout Request Received';
  const fallbackBody = `Hello {Name},\n\nYour payout request of {Amount} has been received and logged.\n\nStatus:\nPending Review`;
  
  const temp = await getTemplateOrFallback('payout_received', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Amount}/g, amount);
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 8. Payout Approved Email
 */
export async function triggerPayoutApprovedEmail(userId: string, email: string, name: string, amount: string) {
  const fallbackSub = 'Payout Approved';
  const fallbackBody = `Hello {Name},\n\nYour payout request has been approved.\n\nAmount:\n{Amount}`;
  
  const temp = await getTemplateOrFallback('payout_approved', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Amount}/g, amount);
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 9. Payout Paid Email
 */
export async function triggerPayoutPaidEmail(userId: string, email: string, name: string, amount: string, method: string) {
  const fallbackSub = 'Payout Sent Successfully';
  const fallbackBody = `Hello {Name},\n\nYour payout has been sent successfully.\n\nAmount:\n{Amount}\n\nPayment Method:\n{Method}`;
  
  const temp = await getTemplateOrFallback('payout_paid', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Amount}/g, amount)
    .replace(/{Method}/g, method);
    
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 10. Giveaway Account Email
 */
export async function triggerGiveawayEmail(userId: string, email: string, name: string) {
  const fallbackSub = 'You Received A Giveaway Account';
  const fallbackBody = `Congratulations {Name}.\n\nA giveaway account has been added to your dashboard.`;
  
  const temp = await getTemplateOrFallback('giveaway', fallbackSub, fallbackBody);
  const body = temp.body.replace(/{Name}/g, name || 'Trader');
  
  await enqueueEmail(userId, email, temp.subject, body);
}

/**
 * 11. Account Available Notification Email
 */
export async function triggerNotifyAvailableEmail(email: string, name: string) {
  const fallbackSub = 'Account Available Again';
  const fallbackBody = `The account you were waiting for is now available.\n\nVisit ATFunding and purchase now.`;
  
  const temp = await getTemplateOrFallback('notify_available', fallbackSub, fallbackBody);
  const body = temp.body.replace(/{Name}/g, name || 'Trader');
  
  await enqueueEmail(null, email, temp.subject, body);
}

/**
 * 12. Payout Rejected Email
 */
export async function triggerPayoutRejectedEmail(userId: string, email: string, name: string, amount: string, reason: string) {
  const fallbackSub = 'Payout Request Declined';
  const fallbackBody = `Hello {Name},\n\nYour payout request of {Amount} has been declined.\n\nReason:\n{Reason}\n\nPlease contact support for more details.`;
  
  const temp = await getTemplateOrFallback('payout_rejected', fallbackSub, fallbackBody);
  const body = temp.body
    .replace(/{Name}/g, name || 'Trader')
    .replace(/{Amount}/g, amount)
    .replace(/{Reason}/g, reason || 'Account conditions check failed or metadata issues.');
    
  await enqueueEmail(userId, email, temp.subject, body);
}
