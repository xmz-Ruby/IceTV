'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import Spinner from '@/components/Spinner';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { adminPost } from '@/features/admin/lib/api';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';
import {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
  normalizeTmdbSettings,
} from '@/lib/tmdb-settings';
import { getErrorMessage } from '@/lib/user-facing-error';
import type { AdminConfig, TmdbSettings } from '@/types/admin';

// 输入保持原文，仅在比较与提交时归一化，避免编辑中被默认值顶回
type TmdbDraft = {
  Enabled: boolean;
  ApiHost: string;
  ApiKey: string;
  ImageHost: string;
};

function draftFromSettings(
  settings: TmdbSettings | undefined,
): TmdbDraft {
  const normalized = normalizeTmdbSettings(settings);
  return {
    Enabled: normalized.Enabled,
    // 归一化结果等于默认值时显示为空，让 placeholder 呈现默认地址
    ApiHost:
      normalized.ApiHost === DEFAULT_TMDB_API_HOST ? '' : normalized.ApiHost,
    ApiKey: normalized.ApiKey,
    ImageHost:
      normalized.ImageHost === DEFAULT_TMDB_IMAGE_HOST
        ? ''
        : normalized.ImageHost,
  };
}

const TmdbConfigTab = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const [draft, setDraft] = useState<TmdbDraft>(() => draftFromSettings(undefined));
  const [baseline, setBaseline] = useState<TmdbDraft>(() =>
    draftFromSettings(undefined),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const next = draftFromSettings(config?.TmdbConfig);
    setDraft(next);
    setBaseline(next);
  }, [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  // 启用前必须填 Key，避免开关打开却始终走兜底路径
  const enableBlocked = draft.Enabled && !draft.ApiKey.trim();

  const handleSave = async () => {
    if (savingRef.current || !dirty || enableBlocked) return;

    setError('');
    setSavedNotice(false);
    savingRef.current = true;
    setSaving(true);
    try {
      await adminPost(
        '/api/admin/tmdb',
        {
          ...draft,
          ApiHost: draft.ApiHost.trim() || DEFAULT_TMDB_API_HOST,
          ImageHost: draft.ImageHost.trim() || DEFAULT_TMDB_IMAGE_HOST,
        },
        '保存 TMDB 设置失败',
      );
      // TmdbEnabled 会随公开配置下发，立即刷新客户端运行时
      try {
        applyClientServerConfig(await fetchClientServerConfig());
      } catch (err) {
        console.warn('刷新客户端运行配置失败:', err);
      }
      const next = draftFromSettings(
        normalizeTmdbSettings({
          ...draft,
          ApiHost: draft.ApiHost.trim() || DEFAULT_TMDB_API_HOST,
          ImageHost: draft.ImageHost.trim() || DEFAULT_TMDB_IMAGE_HOST,
        }),
      );
      setDraft(next);
      setBaseline(next);
      setSavedNotice(true);
      await refreshConfig();
    } catch (err) {
      setError(getErrorMessage(err, '保存 TMDB 设置失败'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSave();
  };

  const patch = (part: Partial<TmdbDraft>) =>
    setDraft((previous) => ({ ...previous, ...part }));

  return (
    <form className='space-y-8' onSubmit={handleSubmit}>
      {error && (
        <p role='alert' className='text-sm text-red-600'>
          {error}
        </p>
      )}
      {savedNotice && !error && (
        <p role='status' className='text-sm text-gray-500'>
          已保存
        </p>
      )}
      <AdminSettingsGroup
        title='TMDB 元数据'
        actions={
          <button
            type='submit'
            disabled={saving || !dirty || enableBlocked}
            className={`${buttonStyles.primary} inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {saving && <Spinner className='h-3.5 w-3.5' />}
            保存
          </button>
        }
      >
        <AdminSettingRow
          label='启用 TMDB'
          description='开启后豆瓣海报点击进入 TMDB 详情页（选季选集后再匹配片源）；未开启或未配置 Key 时保持直接按标题搜索播放'
        >
          <AdminStatusSwitch
            enabled={draft.Enabled}
            isLoading={saving}
            ariaLabel='启用 TMDB'
            onToggle={() => patch({ Enabled: !draft.Enabled })}
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='API 地址'
          htmlFor='tmdb-api-host'
          description={`TMDB API 根地址，默认 ${DEFAULT_TMDB_API_HOST}；网络受限部署可换成自建反代或镜像`}
        >
          <input
            id='tmdb-api-host'
            name='tmdbApiHost'
            type='url'
            inputMode='url'
            autoComplete='off'
            value={draft.ApiHost}
            placeholder={DEFAULT_TMDB_API_HOST}
            onChange={(e) => patch({ ApiHost: e.target.value })}
            className={`${inputStyles.withFocus} w-full sm:w-96`}
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='API Key'
          htmlFor='tmdb-api-key'
          description='v3 api_key 或 v4 read access token（eyJ 开头自动按 Bearer 使用）；仅保存在服务端，不会下发给浏览器'
        >
          <input
            id='tmdb-api-key'
            name='tmdbApiKey'
            type='password'
            autoComplete='off'
            value={draft.ApiKey}
            placeholder='TMDB API Key'
            onChange={(e) => patch({ ApiKey: e.target.value })}
            className={`${inputStyles.withFocus} w-full sm:w-96`}
          />
        </AdminSettingRow>
        <AdminSettingRow
          label='图片地址'
          htmlFor='tmdb-image-host'
          description={`剧照与海报基础地址，默认 ${DEFAULT_TMDB_IMAGE_HOST}；图片经本站代理加载，不会直连该地址`}
        >
          <input
            id='tmdb-image-host'
            name='tmdbImageHost'
            type='url'
            inputMode='url'
            autoComplete='off'
            value={draft.ImageHost}
            placeholder={DEFAULT_TMDB_IMAGE_HOST}
            onChange={(e) => patch({ ImageHost: e.target.value })}
            className={`${inputStyles.withFocus} w-full sm:w-96`}
          />
        </AdminSettingRow>
        {enableBlocked && (
          <AdminSettingRow label=' ' layout='stacked'>
            <p role='alert' className='text-sm text-red-600'>
              启用前需先填写 API Key
            </p>
          </AdminSettingRow>
        )}
      </AdminSettingsGroup>
    </form>
  );
};

export default TmdbConfigTab;
