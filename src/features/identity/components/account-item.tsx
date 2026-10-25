'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/account-item.messages';

import {
  Users,
  Check,
  CircleNotch,
  DoorOpen,
  User,
  UserCircle,
  CaretDown,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/user-avatar';
import { useIdentity } from '../identity-provider';
import { presenceDisplay, getPresenceOptions } from '../presence';
import { LogoutConfirmDialog } from './logout-confirm-dialog';
import styles from './account-item.module.css';

export function AccountItem({ compact = false, variant = 'sidebar' }: { compact?: boolean; variant?: 'sidebar' | 'topbar' }) {
  const { t: uiText, locale } = useTranslation(messages);
  const presenceOptions = getPresenceOptions(locale);
  const { session, openSignIn, openSwitchAccount, presence, presencePreference, setPresence } =
    useIdentity();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openingDialog = useRef(false);
  const user = session.status === 'authenticated' ? session.user : null;
  const label =
    user?.name ?? (session.status === 'checking' ? uiText('正在确认身份') : session.status === 'error' ? uiText('登录服务暂不可用') : uiText('未登录'));
  const status = presenceDisplay(presence, locale);
  const avatarOnly = compact || (variant === 'topbar' && !user);
  const tooltipSide = variant === 'topbar' ? 'bottom' : 'right';
  const button = (
    <button
      type="button"
      data-account-trigger
      data-session-status={session.status}
      data-presence={user ? presence : undefined}
      aria-busy={session.status === 'checking'}
      aria-label={
        user
          ? uiText('Fob 账户：{0} · {1}', { '0': user.name, '1': status.label })
          : session.status === 'error'
            ? uiText('登录服务暂不可用，点击重试登录')
            : uiText('登录 Fob 账户')
      }
      onClick={user ? undefined : openSignIn}
      className={`fob-action ${styles.trigger} ${avatarOnly ? styles.compact : ''} ${variant === 'topbar' ? styles.topbar : ''} ${avatarOnly && !user ? styles.guestCompact : ''}`}
    >
      <span aria-hidden className={`${styles.avatarWrap} ${!user ? styles.guestAvatar : ''}`}>
        {user ? (
          <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
        ) : session.status === 'checking' ? (
          <CircleNotch size={17} className="animate-spin" />
        ) : (
          <User size={18} />
        )}
        {user ? (
          <span className={styles.presence} style={{ backgroundColor: status.color }}>
            {presence === 'do-not-disturb' ? (
              <span className={styles.presenceDash} />
            ) : presence === 'away' ? (
              <span className={styles.presenceHole} />
            ) : null}
          </span>
        ) : null}
      </span>
      {!avatarOnly ? (
        <span className={styles.identityText}><span className={styles.name}>{label}</span></span>
      ) : null}
      {variant === 'topbar' && user && <CaretDown className={styles.topbarCaret} size={12} aria-hidden />}
    </button>
  );
  if (!user)
    return avatarOnly ? (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={tooltipSide}>{uiText('点击登录')}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        {avatarOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              {label} · {status.label}
            </TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
        )}
        {menuOpen && <DropdownMenuContent
          side={variant === 'topbar' ? 'bottom' : compact ? 'right' : 'top'}
          align={variant === 'topbar' ? 'end' : 'start'}
          sideOffset={8}
          className={styles.menu}
          onCloseAutoFocus={(event) => {
            if (openingDialog.current) {
              event.preventDefault();
              openingDialog.current = false;
            }
          }}
        >
          <div className={styles.menuHeader}>
            <span className={`${styles.avatarWrap} ${styles.menuAvatar}`}>
              <UserAvatar
                name={user.name}
                image={user.image}
                className={`${styles.avatar} ${styles.menuAvatar}`}
              />
              <span
                aria-hidden
                className={styles.presence}
                style={{ backgroundColor: status.color }}
              />
            </span>
            <div className={styles.identityText}>
              <p className={styles.menuName}>{user.name}</p>
              <p className={styles.menuEmail}>{user.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator className={styles.separator} />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={`${styles.menuItem} ${styles.statusTrigger}`}>
              <span
                aria-hidden
                className={styles.statusDot}
                style={{ backgroundColor: status.color }}
              />
              {status.label}
              <span className={styles.menuHint}>{uiText('设置状态')}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={styles.statusMenu}>
              <DropdownMenuLabel>{uiText('当前设备状态')}</DropdownMenuLabel>
              {presenceOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={presencePreference === option.value}
                  className={styles.statusItem}
                  onSelect={() => setPresence(option.value)}
                >
                  <span
                    aria-hidden
                    className={styles.statusDot}
                    style={{ backgroundColor: option.color }}
                  />
                  <span className={styles.statusText}>
                    <span>{option.label}</span>
                    <span className={styles.statusDescription}>{option.description}</span>
                  </span>
                  {presencePreference === option.value ? <Check weight="bold" /> : null}
                </DropdownMenuItem>
              ))}
              <p className={styles.statusNote}>{uiText('在线时，5 分钟无操作自动显示离开。')}</p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className={styles.menuItem}
            onSelect={() => {
              openingDialog.current = true;
              openSignIn();
            }}
          >
            <UserCircle weight="fill" />
            {uiText('个人信息')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={styles.menuItem}
            onSelect={() => {
              openingDialog.current = true;
              openSwitchAccount();
            }}
          >
            <Users weight="fill" />
            {uiText('切换账户')}
          </DropdownMenuItem>
          <DropdownMenuSeparator className={styles.separator} />
          <DropdownMenuItem
            variant="destructive"
            className={styles.menuItem}
            onSelect={() => {
              openingDialog.current = true;
              setLogoutOpen(true);
            }}
          >
            <DoorOpen weight="fill" />
            {uiText('退出登录')}
          </DropdownMenuItem>
        </DropdownMenuContent>}
      </DropdownMenu>
      <LogoutConfirmDialog open={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </>
  );
}
