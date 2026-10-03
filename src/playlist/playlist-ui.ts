import { PlaylistManager, type PlaylistTrack } from './playlist-manager';

export class PlaylistUI {
  private manager: PlaylistManager;
  private onPlayTrack: (track: PlaylistTrack) => void;

  // DOM Elements
  private modal: HTMLElement;
  private tabsContainer: HTMLElement;
  private tracksContainer: HTMLElement;
  private createBtn: HTMLButtonElement;
  private addFilesBtn: HTMLButtonElement;
  private addDemoBtn: HTMLButtonElement;
  private shuffleBtn: HTMLButtonElement;
  private shuffleLabel: HTMLElement;
  private repeatBtn: HTMLButtonElement;
  private repeatLabel: HTMLElement;
  private renameBtn: HTMLButtonElement;
  private deleteBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;

  // Dock Elements
  private dockPlaylistTag: HTMLElement | null;
  private dockCounter: HTMLElement | null;
  private dockPlaylistBtn: HTMLButtonElement | null;
  private topPlaylistBtn: HTMLButtonElement | null;

  // Dialog Elements
  private nameDialog: HTMLElement;
  private dialogTitle: HTMLElement;
  private dialogInput: HTMLInputElement;
  private dialogCancelBtn: HTMLButtonElement;
  private dialogSaveBtn: HTMLButtonElement;
  private dialogMode: 'create' | 'rename' = 'create';
  private targetRenameId: string = '';

  constructor(manager: PlaylistManager, onPlayTrack: (track: PlaylistTrack) => void) {
    this.manager = manager;
    this.onPlayTrack = onPlayTrack;

    this.modal = document.getElementById('playlist-modal')!;
    this.tabsContainer = document.getElementById('playlist-tabs-container')!;
    this.tracksContainer = document.getElementById('playlist-tracks-container')!;
    this.createBtn = document.getElementById('modal-create-pl-btn') as HTMLButtonElement;
    this.addFilesBtn = document.getElementById('pl-add-files-btn') as HTMLButtonElement;
    this.addDemoBtn = document.getElementById('pl-add-demo-btn') as HTMLButtonElement;
    this.shuffleBtn = document.getElementById('pl-shuffle-btn') as HTMLButtonElement;
    this.shuffleLabel = document.getElementById('pl-shuffle-label')!;
    this.repeatBtn = document.getElementById('pl-repeat-btn') as HTMLButtonElement;
    this.repeatLabel = document.getElementById('pl-repeat-label')!;
    this.renameBtn = document.getElementById('pl-rename-btn') as HTMLButtonElement;
    this.deleteBtn = document.getElementById('pl-delete-btn') as HTMLButtonElement;
    this.closeBtn = document.getElementById('playlist-close-btn') as HTMLButtonElement;
    this.fileInput = document.getElementById('playlist-multi-file-input') as HTMLInputElement;

    this.dockPlaylistTag = document.getElementById('dock-playlist-tag');
    this.dockCounter = document.getElementById('playlist-dock-counter');
    this.dockPlaylistBtn = document.getElementById('dock-playlist-btn') as HTMLButtonElement | null;
    this.topPlaylistBtn = document.getElementById('top-playlist-btn') as HTMLButtonElement | null;

    this.nameDialog = document.getElementById('playlist-name-dialog')!;
    this.dialogTitle = document.getElementById('dialog-title')!;
    this.dialogInput = document.getElementById('dialog-playlist-name') as HTMLInputElement;
    this.dialogCancelBtn = document.getElementById('dialog-cancel-btn') as HTMLButtonElement;
    this.dialogSaveBtn = document.getElementById('dialog-save-btn') as HTMLButtonElement;

    this.bindEvents();
    this.render();

    this.manager.onPlaylistsChanged = () => this.render();
    this.manager.onTrackChanged = () => this.renderTracks();
  }

  private bindEvents(): void {
    // Open/Close
    const toggleModal = () => {
      const isOpen = this.modal.classList.toggle('open');
      if (isOpen) this.render();
    };
    this.dockPlaylistBtn?.addEventListener('click', toggleModal);
    this.topPlaylistBtn?.addEventListener('click', toggleModal);
    this.closeBtn.addEventListener('click', () => this.modal.classList.remove('open'));
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.modal.classList.remove('open');
    });

    // Create Playlist Dialog
    this.createBtn.addEventListener('click', () => {
      this.dialogMode = 'create';
      this.dialogTitle.textContent = 'Новый плейлист';
      this.dialogInput.value = '';
      this.openDialog();
    });

    // Rename Playlist Dialog
    this.renameBtn.addEventListener('click', () => {
      const active = this.manager.getActivePlaylist();
      this.dialogMode = 'rename';
      this.targetRenameId = active.id;
      this.dialogTitle.textContent = 'Переименовать плейлист';
      this.dialogInput.value = active.name;
      this.openDialog();
    });

    // Dialog Save & Cancel
    this.dialogCancelBtn.addEventListener('click', () => this.closeDialog());
    this.dialogSaveBtn.addEventListener('click', () => this.saveDialog());
    this.dialogInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveDialog();
      if (e.key === 'Escape') this.closeDialog();
    });

    // Delete Playlist
    this.deleteBtn.addEventListener('click', () => {
      const active = this.manager.getActivePlaylist();
      if (this.manager.getPlaylists().length <= 1) {
        this.showToast('Нельзя удалить единственный плейлист');
        return;
      }
      this.manager.deletePlaylist(active.id);
      this.showToast(`Плейлист «${active.name}» удалён`);
      this.render();
    });

    // Add Files
    this.addFilesBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', async () => {
      if (this.fileInput.files && this.fileInput.files.length > 0) {
        const newTracks = await this.manager.addFiles(this.fileInput.files);
        if (newTracks.length > 0 && !this.manager.getCurrentTrack()) {
          this.onPlayTrack(newTracks[0]);
        }
        this.fileInput.value = '';
        this.render();
      }
    });

    // Add Demo Track
    this.addDemoBtn.addEventListener('click', () => {
      this.manager.addDemoTrack();
      this.render();
    });

    // Shuffle & Repeat
    this.shuffleBtn.addEventListener('click', () => {
      const on = this.manager.toggleShuffle();
      this.shuffleBtn.classList.toggle('active', on);
      this.shuffleLabel.textContent = on ? 'Случайно: ВКЛ' : 'Случайно';
    });

    this.repeatBtn.addEventListener('click', () => {
      const mode = this.manager.cycleRepeatMode();
      this.repeatLabel.textContent =
        mode === 'all' ? 'Повтор: Все' : mode === 'one' ? 'Повтор: Трек' : 'Без повтора';
      this.repeatBtn.classList.toggle('active', mode !== 'none');
    });

    // Drop audio files directly into modal
    this.modal.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.modal.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const newTracks = await this.manager.addFiles(files);
        if (newTracks.length > 0 && !this.manager.getCurrentTrack()) {
          this.onPlayTrack(newTracks[0]);
        }
        this.render();
      }
    });
  }

  private openDialog(): void {
    this.nameDialog.style.opacity = '1';
    this.nameDialog.style.pointerEvents = 'auto';
    setTimeout(() => this.dialogInput.focus(), 50);
  }

  private closeDialog(): void {
    this.nameDialog.style.opacity = '0';
    this.nameDialog.style.pointerEvents = 'none';
  }

  private saveDialog(): void {
    const val = this.dialogInput.value.trim();
    if (!val) return;
    if (this.dialogMode === 'create') {
      this.manager.createPlaylist(val);
    } else {
      this.manager.renamePlaylist(this.targetRenameId, val);
    }
    this.closeDialog();
    this.render();
  }

  render(): void {
    const playlists = this.manager.getPlaylists();
    const active = this.manager.getActivePlaylist();

    // Update Dock Info
    if (this.dockPlaylistTag) {
      this.dockPlaylistTag.textContent = active.name;
    }
    if (this.dockCounter) {
      this.dockCounter.textContent = String(active.tracks.length);
    }

    // Delete button disabled if only 1 playlist
    this.deleteBtn.style.opacity = playlists.length <= 1 ? '0.4' : '1';
    this.deleteBtn.style.pointerEvents = playlists.length <= 1 ? 'none' : 'auto';

    // Render Tabs
    this.tabsContainer.innerHTML = '';
    playlists.forEach((pl) => {
      const btn = document.createElement('button');
      btn.className = `playlist-tab-btn ${pl.id === active.id ? 'active' : ''}`;
      btn.textContent = `${pl.name} (${pl.tracks.length})`;
      btn.addEventListener('click', () => {
        this.manager.setActivePlaylist(pl.id);
        this.render();
      });
      this.tabsContainer.appendChild(btn);
    });

    this.renderTracks();
  }

  renderTracks(): void {
    const active = this.manager.getActivePlaylist();
    const curTrack = this.manager.getCurrentTrack();

    this.tracksContainer.innerHTML = '';

    if (active.tracks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'playlist-empty-state';
      empty.innerHTML = `
        <div style="font-size:28px;">🎵</div>
        <div>В этом плейлисте пока нет треков</div>
        <div class="playlist-empty-cue">Нажмите «+ Добавить треки» или перетащите аудиофайлы сюда</div>
      `;
      this.tracksContainer.appendChild(empty);
      return;
    }

    active.tracks.forEach((track, idx) => {
      const isCurrent = curTrack?.id === track.id;
      const row = document.createElement('div');
      row.className = `playlist-track-row ${isCurrent ? 'is-current' : ''}`;

      const coverStyle = track.coverArtUrl
        ? `background-image: url('${track.coverArtUrl}');`
        : 'background: linear-gradient(135deg, #8a7cff, #4ce0d2);';

      row.innerHTML = `
        <div class="track-row-left">
          <div class="track-mini-disc" style="${coverStyle}"></div>
          <div class="track-row-meta">
            <div class="track-row-title">${idx + 1}. ${escapeHtml(track.title)}</div>
            <div class="track-row-sub">${track.artist || (track.sourceType === 'demo' ? 'Демо-трек' : 'Локальный файл')}</div>
          </div>
        </div>
        <div class="track-row-actions">
          ${
            isCurrent
              ? `<div class="playing-wave-bars"><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div></div>`
              : ''
          }
          <button class="track-action-btn delete-btn" title="Удалить из плейлиста" data-id="${track.id}">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `;

      // Click row to play
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.delete-btn')) return;
        this.onPlayTrack(track);
      });

      // Delete track
      const delBtn = row.querySelector('.delete-btn');
      delBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.removeTrack(active.id, track.id);
        this.render();
      });

      this.tracksContainer.appendChild(row);
    });
  }

  toggle(): boolean {
    const isOpen = this.modal.classList.toggle('open');
    if (isOpen) this.render();
    return isOpen;
  }

  private showToast(msg: string): void {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 2400);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
