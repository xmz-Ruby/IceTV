import { connection } from 'next/server';
import { Suspense } from 'react';

import { SubjectPageClient } from '@/features/tmdb/components/SubjectPageClient';
import { SubjectSkeleton } from '@/features/tmdb/components/SubjectSkeleton';

export default async function SubjectPage() {
  await connection();

  return (
    <Suspense fallback={<SubjectSkeleton />}>
      <SubjectPageClient />
    </Suspense>
  );
}
