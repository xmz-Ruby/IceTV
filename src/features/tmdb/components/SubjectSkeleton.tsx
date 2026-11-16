import PageLayout from '@/components/PageLayout';
import SkeletonText from '@/components/SkeletonText';
import {
  EPISODE_GRID_CLASS,
  EPISODE_STILL_ASPECT_CLASS,
} from '@/features/tmdb/components/subject-layout';

// 与 SubjectPageClient 真实布局共用常量（subject-layout.ts）与页面外壳，改版式两处同步
export function SubjectSkeleton() {
  return (
    <PageLayout activePath='/subject' showDesktopBack>
      <div className='mx-auto w-full max-w-[1680px] px-4 pt-6 sm:px-6 lg:px-8'>
        <div className='flex flex-col gap-6 sm:flex-row'>
          <div className='skeleton aspect-[2/3] w-32 shrink-0 rounded-lg sm:w-44' />
          <div className='min-w-0 flex-1 space-y-3 py-2'>
            <SkeletonText
              className='text-2xl font-bold'
              barClassName='h-7 w-64 rounded'
            />
            <SkeletonText className='text-sm' barClassName='h-4 w-40 rounded' />
            <SkeletonText
              className='text-sm'
              barClassName='h-4 w-full rounded'
            />
            <SkeletonText
              className='text-sm'
              barClassName='h-4 w-3/4 rounded'
            />
          </div>
        </div>
        <div className='mt-8 space-y-4'>
          <SkeletonText
            className='text-sm'
            barClassName='h-7 w-48 rounded-full'
          />
          <div className={EPISODE_GRID_CLASS}>
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className='space-y-2'>
                <div
                  className={`skeleton w-full rounded-lg ${EPISODE_STILL_ASPECT_CLASS}`}
                />
                <SkeletonText
                  className='text-[13px]'
                  barClassName='h-4 w-3/4 rounded'
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

export default SubjectSkeleton;
