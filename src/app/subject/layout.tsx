import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function SubjectLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute
      activePath='/subject'
      message='请先登录后再查看详情。'
      showDesktopBack
    >
      {children}
    </AuthenticatedRoute>
  );
}
