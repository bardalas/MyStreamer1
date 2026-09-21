/* ---------- the parent code ----------
   One code for the household (data/kids.js keeps it for the device): it is what lets a kids profile be
   left or loosened, and what opens a locked profile. Asked on the code pad (ui/sheets.js). */
import {checkPin, failSum, grownUpSum, hasPin, kidsTeen, pinLockedFor, setPin} from '../data/kids.js';
import {tr} from '../i18n.js';
import {askCode} from './sheets.js';

const lockedSays = () => { const m = Math.ceil(pinLockedFor() / 60e3); return m ? tr('kids.pin.locked', {m}) : ''; };
/** A new code, typed twice. */
export async function choosePin(){
  const a = await askCode({title: tr('kids.pin.new'), note: tr('kids.pin.newNote'), mask: true, ok: tr('common.ok')});
  if(!a) return false;
  const b = await askCode({title: tr('kids.pin.again'), mask: true, ok: tr('common.ok'), check: p => p === a || tr('kids.pin.mismatch')});
  if(!b) return false;
  setPin(a);
  return true;
}
/**
 * The code - or, for a parent who forgot it, a grown-up's sum. [sum]: whether the sum is offered. It never is
 * where a teenager could be the one asked (a teenager's profile), nor for a lock (ui: the picker) - a
 * teenager with a calculator answers it too; there only the code will do.
 */
export async function askPin(title, {sum = !kidsTeen()} = {}){
  const r = await askCode({title, mask: true, ok: tr('common.ok'), note: lockedSays(), check: p => checkPin(p) || lockedSays() || tr('kids.pin.wrong'),
    extra: sum ? {label: tr('kids.pin.forgot'), value: 'forgot'} : null});
  if(r !== 'forgot') return !!r;
  const {q, a} = grownUpSum();
  return !!await askCode({title: tr('kids.sum.title'), note: lockedSays() || tr('kids.sum.note', {q: `<bdi dir="ltr">${q}</bdi>`}), len: a.length, ok: tr('common.ok'),
    check: v => { if(pinLockedFor()) return lockedSays(); if(v === a) return true; failSum(); return lockedSays(); }});
}
/** A grown-up's say-so for [title]: the code when there is one (no sum: this is asked wherever anyone may
    stand - the picker); with none set yet, nothing to ask. */
export const grownUp = title => hasPin() ? askPin(title, {sum: false}) : Promise.resolve(true);
/** The code, set first if there is none: what locking something needs. */
export const pinFor = title => hasPin() ? askPin(title) : choosePin();
