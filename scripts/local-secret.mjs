import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';

// Check and chmod the opened inode, never a second path lookup after access/stat.
export async function ensureLocalSecret(path) {
 let handle,created=false;
 try {
  try {
   handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   created=true;
  } catch(error) {
   if(error.code!=='EEXIST')throw error;
   handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  }
  const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1)throw Error('Secret must be a regular file with one link');
  if(!created&&(info.size===0||info.size>16384))throw Error('Existing secret file has invalid size');
  if(created)await handle.writeFile(randomBytes(32).toString('base64url'));
  await handle.chmod(0o600);
 } finally {await handle?.close();}
}
