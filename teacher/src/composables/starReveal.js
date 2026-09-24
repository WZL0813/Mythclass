/**
 * 登录成功那一下的星幕。
 *
 * 谁都能拉起（playStarReveal），App 负责把 StarReveal 挂到最上层；
 * 星幕自己控制节奏，收尾时分两步通知：
 *   unveil —— 开始淡出，这时候底下页面由淡到正常（两边交叉，不会闪）
 *   closed —— 收干净了，可以卸载
 */
import { ref } from 'vue';

export const revealActive = ref(false); // 星幕在不在
export const pageVeiled = ref(false); // 底下的页面是不是全透明

let resolveDone = null;

/** 拉星幕。返回的 Promise 在星幕收干净时 resolve */
export function playStarReveal() {
  revealActive.value = true;
  pageVeiled.value = true;
  return new Promise((resolve) => {
    resolveDone = resolve;
  });
}

/** 星幕开始淡出：页面这一刻开始显形 */
export function unveilPage() {
  pageVeiled.value = false;
}

/** 星幕收干净了，卸掉它 */
export function closeStarReveal() {
  revealActive.value = false;
  pageVeiled.value = false;
  if (resolveDone) {
    resolveDone();
    resolveDone = null;
  }
}
