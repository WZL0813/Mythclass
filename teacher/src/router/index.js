import { createRouter, createWebHistory } from 'vue-router';
import { tokenStore } from '@/api';

const routes = [
  { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: 'Mythclass 若思班级一体机管理系统' } },
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { title: '若思班级 · 教师端' } },
  { path: '/register', name: 'register', component: () => import('@/views/RegisterView.vue'), meta: { title: '注册 · 若思班级' } },
  { path: '/docs', name: 'docs', component: () => import('@/views/DocsView.vue'), meta: { title: '文档 · Mythclass' } },
  { path: '/about', name: 'about', component: () => import('@/views/AboutView.vue'), meta: { title: '关于 · Mythclass' } },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { title: '控制台 · Mythclass', requiresAuth: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  document.title = to.meta.title || 'Mythclass 若思班级一体机管理系统';
  if (to.meta.requiresAuth && !tokenStore.get()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});

export default router;
