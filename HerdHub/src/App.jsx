import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import {
  AppBar,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Checkbox,
  Chip,
  CircularProgress,
  CssBaseline,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  Menu,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import BookmarkAddedIcon from '@mui/icons-material/BookmarkAdded';
import BookmarkRemoveIcon from '@mui/icons-material/BookmarkRemove';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import EditIcon from '@mui/icons-material/Edit';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PeopleIcon from '@mui/icons-material/People';
import {
  Document, Paragraph,
  Table as DocxTable, TableCell as DocxTableCell, TableRow as DocxTableRow,
  TextRun, ImageRun, WidthType, HeadingLevel, Packer,
} from 'docx';

// ── Login / Register page ─────────────────────────────────────────────────────
function LoginPage({ onAuth }) {
  const [mode, setMode]       = useState('login'); // 'login' | 'register'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const resp = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, remember: mode === 'login' ? remember : true }),
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.error ?? 'Something went wrong'); return; }
      onAuth(data);
    } catch {
      setError('Network error — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(145deg, #1b4332 0%, #2d6a4f 100%)',
    }}>
      <Card elevation={8} sx={{ p: 4, borderRadius: 4, maxWidth: 380, width: '100%', mx: 2 }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography sx={{ fontSize: '3rem', mb: 0.5 }}>🐄</Typography>
          <Typography variant="h5">HerdHub</Typography>
          <Typography variant="body2" color="text.secondary">Cattle breed reference</Typography>
        </Box>
        <form onSubmit={submit}>
          <Stack spacing={2}>
            {error && (
              <Box sx={{ bgcolor: '#fff0f0', border: '1px solid', borderColor: 'error.main', borderRadius: 2, p: 1.5 }}>
                <Typography variant="body2" color="error.main">{error}</Typography>
              </Box>
            )}
            <TextField
              label="Email" type="email" size="small" fullWidth required
              value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            />
            <TextField
              label="Password" type="password" size="small" fullWidth required
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              helperText={mode === 'register' ? 'At least 8 characters' : ''}
            />
            {mode === 'login' && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    size="small"
                    sx={{ color: '#2d6a4f', '&.Mui-checked': { color: '#2d6a4f' } }}
                  />
                }
                label={<Typography variant="body2" color="text.secondary">Remember me for 30 days</Typography>}
                sx={{ mx: 0 }}
              />
            )}
            <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
              {loading ? <CircularProgress size={22} sx={{ color: 'white' }} /> : (mode === 'login' ? 'Sign in' : 'Create account')}
            </Button>
          </Stack>
        </form>
        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" align="center">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <Box component="span"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 600 }}
          >{mode === 'login' ? 'Sign up' : 'Sign in'}</Box>
        </Typography>
      </Card>
    </Box>
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const theme = createTheme({
  palette: {
    primary:    { main: '#2d6a4f' },
    secondary:  { main: '#f4a261' },
    error:      { main: '#e63946' },
    info:       { main: '#457b9d' },
    warning:    { main: '#c9952a' },
    background: { default: '#f5f5f0', paper: '#ffffff' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Inter", "Roboto", sans-serif',
    h5: { fontWeight: 800 },
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
  },
  components: {
    MuiAppBar:    { styleOverrides: { root: { boxShadow: 'none' } } },
    MuiCard:      { styleOverrides: { root: { borderRadius: 16, border: '1px solid rgba(0,0,0,0.07)' } } },
    MuiButton:    { styleOverrides: { root: { borderRadius: 8, textTransform: 'none', fontWeight: 600 } } },
    MuiChip:      { styleOverrides: { root: { borderRadius: 6, fontWeight: 500 } } },
    MuiDialog:    { styleOverrides: { paper: { borderRadius: 20 } } },
    MuiTextField: { styleOverrides: { root: { '& .MuiOutlinedInput-root': { borderRadius: 10 } } } },
    MuiTab:       { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minWidth: 'auto' } } },
  },
});

const TAG_COLORS = [
  { color: '#e63946', bg: '#fdecea' },
  { color: '#457b9d', bg: '#e8f4f8' },
  { color: '#2d6a4f', bg: '#e8f5e9' },
  { color: '#b5651d', bg: '#fef3e2' },
  { color: '#7b2d8b', bg: '#f3e5f5' },
  { color: '#c9952a', bg: '#fff8e1' },
  { color: '#00838f', bg: '#e0f7fa' },
  { color: '#6c757d', bg: '#f0f0f0' },
];

const _tagColorCache = new Map();
function tagColor(tag) {
  if (_tagColorCache.has(tag)) return _tagColorCache.get(tag);
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  const result = TAG_COLORS[h % TAG_COLORS.length];
  _tagColorCache.set(tag, result);
  return result;
}

/** Derive the thumbnail URL from a full image URL: /images/foo.jpg → /api/thumb/foo.jpg */
function thumbUrl(imageUrl) {
  if (!imageUrl) return null;
  const filename = imageUrl.replace(/^\/images\//, '');
  return `/api/thumb/${filename}`;
}

function TagChips({ tags, size = 'small' }) {
  if (!tags?.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {tags.map((t) => {
        const { color, bg } = tagColor(t);
        const label = t.length > 10 ? t.slice(0, 10) + '…' : t;
        return (
          <Chip key={t} label={label} title={t.length > 10 ? t : undefined} size={size}
            sx={{ fontSize: '0.65rem', color, bgcolor: bg, border: `1px solid ${color}33`, fontWeight: 600 }}
          />
        );
      })}
    </Box>
  );
}

function TagInput({ value, onChange, allTags }) {
  const tags = Array.isArray(value) ? value : [];
  return (
    <Autocomplete
      multiple freeSolo
      value={tags}
      onChange={(_, newVal) => onChange(newVal.map((v) => (typeof v === 'string' ? v.trim() : v)).filter(Boolean))}
      options={allTags.filter((t) => !tags.includes(t))}
      renderTags={(vals, getTagProps) =>
        vals.map((tag, index) => {
          const props = getTagProps({ index });
          const label = tag.length > 10 ? tag.slice(0, 10) + '…' : tag;
          return <Chip {...props} key={props.key} label={label} title={tag.length > 10 ? tag : undefined} size="small" />;
        })
      }
      renderInput={(params) => (
        <TextField {...params} size="small" label="Tags" placeholder={tags.length === 0 ? 'Add tag, press Enter…' : ''} />
      )}
    />
  );
}

const BreedCard = memo(function BreedCard({ breed, inMyList, onCardClick, onToggle, onEdit, showEdit }) {
  // 0 = try thumb, 1 = fall back to original, 2 = show placeholder
  const [imgStage, setImgStage] = useState(0);
  const thumb = thumbUrl(breed.imageUrl);
  const imgSrc = imgStage === 0 ? thumb : breed.imageUrl;
  // Stable per-breed callbacks so memo can skip re-renders when only unrelated state changes
  const handleClick = useCallback(() => onCardClick(breed), [onCardClick, breed]);
  const handleToggle = useCallback((e) => { e.stopPropagation(); onToggle(breed); }, [onToggle, breed]);
  const handleEdit = useCallback((e) => { e.stopPropagation(); onEdit(breed); }, [onEdit, breed]);
  return (
    <Card
      elevation={0}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.2s, box-shadow 0.2s',
        boxShadow: inMyList
          ? '0 0 0 2px #2d6a4f, 0 4px 20px rgba(45,106,79,0.15)'
          : '0 2px 8px rgba(0,0,0,0.06)',
        '&:hover': {
          transform: 'translateY(-6px)',
          boxShadow: inMyList
            ? '0 0 0 2px #2d6a4f, 0 12px 32px rgba(45,106,79,0.2)'
            : '0 12px 32px rgba(0,0,0,0.12)',
        },
      }}
    >
      <CardActionArea
        onClick={handleClick}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box sx={{ position: 'relative', overflow: 'hidden' }}>
          {breed.imageUrl && imgStage < 2 ? (
            <CardMedia
              component="img"
              height="180"
              image={imgSrc}
              alt={breed.name}
              loading="lazy"
              decoding="async"
              onError={() => setImgStage((s) => s + 1)}
              sx={{ objectFit: 'cover', transition: 'transform 0.3s', '&:hover': { transform: 'scale(1.04)' } }}
            />
          ) : (
            <Box sx={{
              height: 180,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)',
              fontSize: '3.5rem',
            }}>
              🐄
            </Box>
          )}
          {inMyList && (
            <Box sx={{
              position: 'absolute', top: 8, left: 8,
              bgcolor: '#2d6a4f', color: 'white',
              borderRadius: '50%', width: 28, height: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}>
              <BookmarkAddedIcon sx={{ fontSize: 15 }} />
            </Box>
          )}
        </Box>
        <CardContent sx={{ flexGrow: 1, pb: '6px !important', px: 1.5, pt: 1.5 }}>
          <Typography variant="subtitle1" noWrap title={breed.name} sx={{ mb: 0.3 }}>
            {breed.name}
          </Typography>
          {breed.origin && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.75 }}>
              📍 {breed.origin}
            </Typography>
          )}
          <TagChips tags={breed.tags} />
        </CardContent>
      </CardActionArea>
      <Divider sx={{ mx: 1.5, opacity: 0.4 }} />
      <Box sx={{ px: 1, py: 0.5, display: 'flex', justifyContent: 'space-between' }}>
        {showEdit ? (
          <Tooltip title="Edit breed">
            <IconButton size="small" onClick={handleEdit}>
              <EditIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : <Box />}
        <Tooltip title={inMyList ? 'Remove from My Herd' : 'Add to My Herd'}>
          <IconButton
            size="small"
            sx={{ color: inMyList ? '#2d6a4f' : 'text.secondary' }}
            onClick={handleToggle}
          >
            {inMyList ? <BookmarkRemoveIcon sx={{ fontSize: 18 }} /> : <BookmarkAddIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Card>
  );
});

function LoadingSkeleton() {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
      {Array.from({ length: 24 }).map((_, i) => (
        <Card key={i} elevation={0} sx={{ borderRadius: 4 }}>
          <Skeleton variant="rectangular" height={180} />
          <CardContent sx={{ pt: 1.5 }}>
            <Skeleton variant="text" width="70%" height={24} />
            <Skeleton variant="text" width="50%" height={18} sx={{ mb: 1 }} />
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Skeleton variant="rounded" width={50} height={20} />
              <Skeleton variant="rounded" width={40} height={20} />
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

function BreedDialog({ breed, onClose, onEdit, onToggle, inMyList, showEdit }) {
  const [imgErr, setImgErr] = useState(false);
  if (!breed) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth TransitionProps={{ unmountOnExit: true }}>
      <Box sx={{ position: 'relative' }}>
        {breed.imageUrl && !imgErr ? (
          <Box
            component="img"
            src={breed.imageUrl}
            alt={breed.name}
            onError={() => setImgErr(true)}
            sx={{ width: '100%', height: 260, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={{
            height: 200,
            background: 'linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '6rem',
          }}>🐄</Box>
        )}
        <IconButton
          onClick={onClose}
          sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.45)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' } }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent sx={{ pt: 2.5, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>{breed.name}</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
            {showEdit && (
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => { onClose(); onEdit(breed); }}><EditIcon /></IconButton>
              </Tooltip>
            )}
            <Tooltip title={inMyList ? 'Remove from selection' : 'Add to selection'}>
              <IconButton size="small" sx={{ color: inMyList ? '#2d6a4f' : 'text.secondary' }} onClick={onToggle}>
                {inMyList ? <BookmarkRemoveIcon /> : <BookmarkAddIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Stack spacing={1.5}>
          {breed.origin && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.8} sx={{ textTransform: 'uppercase', display: 'block' }}>Origin</Typography>
              <Typography variant="body1">{breed.origin}</Typography>
            </Box>
          )}
          {breed.subspecies && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.8} sx={{ textTransform: 'uppercase', display: 'block' }}>Subspecies</Typography>
              <Typography variant="body1">{breed.subspecies}</Typography>
            </Box>
          )}
          {breed.tags?.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.8} sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Tags</Typography>
              <TagChips tags={breed.tags} size="medium" />
            </Box>
          )}
          {breed.wikiUrl && (
            <Button
              component="a" href={breed.wikiUrl} target="_blank" rel="noreferrer"
              size="small" variant="outlined" endIcon={<OpenInNewIcon />} sx={{ alignSelf: 'flex-start', mt: 0.5 }}
            >
              Wikipedia
            </Button>
          )}
          {breed.comments && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.8} sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Comments</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{breed.comments}</Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} variant="contained" fullWidth size="large">Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function EditDialog({ breed, onClose, onSave, allTags }) {
  const [form, setForm] = useState({ ...breed });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pasteZoneRef = useRef(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const uploadDataUrl = async (dataUrl) => {
    setUploading(true);
    try {
      const resp = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name || breed.name, dataUrl }),
      });
      const { path } = await resp.json();
      setForm((f) => ({ ...f, imageUrl: path }));
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => uploadDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handlePaste = (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    const reader = new FileReader();
    reader.onload = (ev) => uploadDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Edit Breed
        <Typography variant="body2" color="text.secondary">{breed.name}</Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2.5 }}>
        {/* Paste zone */}
        <Box
          ref={pasteZoneRef}
          tabIndex={0}
          onPaste={handlePaste}
          sx={{
            border: '2px dashed',
            borderColor: uploading ? 'primary.main' : 'grey.300',
            borderRadius: 2,
            p: 1.5,
            textAlign: 'center',
            cursor: 'pointer',
            outline: 'none',
            bgcolor: uploading ? 'primary.50' : 'grey.50',
            transition: 'all 0.2s',
            '&:focus': { borderColor: 'primary.main', bgcolor: 'primary.50' },
          }}
          onClick={() => fileRef.current.click()}
        >
          {form.imageUrl ? (
            <Box sx={{ position: 'relative', display: 'inline-block' }}>
              <Box
                component="img" src={form.imageUrl} alt={form.name}
                sx={{ maxHeight: 160, maxWidth: '100%', objectFit: 'contain', borderRadius: 1, display: 'block', mx: 'auto' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <Tooltip title="Remove image">
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setForm((f) => ({ ...f, imageUrl: '' })); }}
                  sx={{
                    position: 'absolute', top: -10, right: -10,
                    bgcolor: 'error.main', color: 'white', width: 24, height: 24,
                    '&:hover': { bgcolor: 'error.dark' },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              📷 Tap to choose a photo · or paste (Ctrl+V) on desktop
            </Typography>
          )}
          {uploading && (
            <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5 }}>
              Saving image…
            </Typography>
          )}
        </Box>
        {/* hidden file input — accept image from gallery or camera */}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField fullWidth label="Image URL" size="small" value={form.imageUrl || ''} onChange={set('imageUrl')} />
        </Box>
        <TextField fullWidth label="Name" size="small" value={form.name || ''} onChange={set('name')} />
        <TextField fullWidth label="Origin" size="small" value={form.origin || ''} onChange={set('origin')} />
        <TextField fullWidth label="Subspecies" size="small" value={form.subspecies || ''} onChange={set('subspecies')} />
        <TextField fullWidth label="Wikipedia URL" size="small" value={form.wikiUrl || ''} onChange={set('wikiUrl')} />
        <TagInput value={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} allTags={allTags} />
        <TextField fullWidth label="Comments" size="small" multiline minRows={3} value={form.comments || ''} onChange={set('comments')} />
      </DialogContent>
      <DialogActions sx={{ p: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ flex: 1 }}>Cancel</Button>
        <Button variant="contained" onClick={() => onSave(form, breed.name)} sx={{ flex: 1 }} disabled={uploading}>Save changes</Button>
      </DialogActions>
    </Dialog>
  );
}

const PAGE_SIZE = 40;

function BreedGrid({ breeds, myList, onCardClick, onToggle, onEdit, showEdit }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lastBreeds, setLastBreeds] = useState(breeds);
  const sentinelRef = useRef(null);

  // Reset pagination when the breed list changes (React's recommended pattern for derived state)
  if (lastBreeds !== breeds) {
    setLastBreeds(breeds);
    setVisibleCount(PAGE_SIZE);
  }

  // Infinite scroll — bump visibleCount when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisibleCount((n) => n + PAGE_SIZE); },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [breeds]);

  const visible = breeds.slice(0, visibleCount);

  if (breeds.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', mt: 10 }}>
        <Typography sx={{ fontSize: '4rem', mb: 1 }}>🐄</Typography>
        <Typography variant="h6" color="text.secondary">No breeds found</Typography>
        <Typography variant="body2" color="text.secondary">Try adjusting your search or filters</Typography>
      </Box>
    );
  }
  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
        {visible.map((breed) => (
          <BreedCard
            key={breed.id ?? breed.name}
            breed={breed}
            inMyList={myList.has(breed.id ?? breed.name)}
            onCardClick={onCardClick}
            onToggle={onToggle}
            onEdit={onEdit}
            showEdit={showEdit}
          />
        ))}
      </Box>
      {visibleCount < breeds.length && (
        <Box ref={sentinelRef} sx={{ textAlign: 'center', py: 4 }}>
          <Skeleton variant="rounded" width={120} height={20} sx={{ mx: 'auto' }} />
        </Box>
      )}
      {visibleCount >= breeds.length && breeds.length > PAGE_SIZE && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 3 }}>
          All {breeds.length} breeds loaded
        </Typography>
      )}
    </>
  );
}

function AddBreedDialog({ onClose, onSave, allTags }) {
  const [form, setForm] = useState({ name: '', origin: '', subspecies: '', tags: [], wikiUrl: '', imageUrl: '' });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Add New Breed
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2.5 }}>
        <TextField fullWidth label="Name *" size="small" value={form.name} onChange={set('name')} />
        <TextField fullWidth label="Origin" size="small" value={form.origin} onChange={set('origin')} />
        <TextField fullWidth label="Subspecies" size="small" value={form.subspecies} onChange={set('subspecies')} />
        <TextField fullWidth label="Wikipedia URL" size="small" value={form.wikiUrl} onChange={set('wikiUrl')} />
        <TagInput value={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} allTags={allTags} />
        <TextField fullWidth label="Image URL" size="small" value={form.imageUrl} onChange={set('imageUrl')} />
      </DialogContent>
      <DialogActions sx={{ p: 2.5, gap: 1 }}>
        <Button onClick={onClose} sx={{ flex: 1 }}>Cancel</Button>
        <Button variant="contained" onClick={() => onSave(form)} disabled={!form.name.trim()} sx={{ flex: 1 }}>Add Breed</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Account management page (admin only) ──────────────────────────────────────
function AccountsPage({ onClose, onImpersonate, currentEmail }) {
  const [accounts, setAccounts]   = useState([]);
  const [fetching, setFetching]   = useState(true);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw]     = useState('');
  const [resetError, setResetError] = useState('');
  const [delTarget, setDelTarget] = useState(null);

  useEffect(() => {
    fetch('/api/accounts').then((r) => r.json()).then(setAccounts).finally(() => setFetching(false));
  }, []);

  const patchAccount = async (id, body) => {
    const resp = await fetch(`/api/accounts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return resp;
  };

  const handleRoleChange = async (account, newRole) => {
    await patchAccount(account.id, { role: newRole });
    setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, role: newRole } : a));
  };

  const handleResetPassword = async () => {
    setResetError('');
    const resp = await patchAccount(resetTarget.id, { password: resetPw });
    if (!resp.ok) { const d = await resp.json(); setResetError(d.error ?? 'Failed'); return; }
    setResetTarget(null); setResetPw('');
  };

  const handleDelete = async () => {
    await fetch(`/api/accounts/${delTarget.id}`, { method: 'DELETE' });
    setAccounts((prev) => prev.filter((a) => a.id !== delTarget.id));
    setDelTarget(null);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<CloseIcon />} onClick={onClose}>Back</Button>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Accounts</Typography>
        {!fetching && <Typography variant="body2" color="text.secondary">({accounts.length})</Typography>}
      </Box>

      {fetching ? <CircularProgress /> : (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} hover sx={{ '&:last-child td': { border: 0 } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {a.email}
                      </Typography>
                      {a.email === currentEmail && (
                        <Chip label="you" size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small" value={a.role}
                      onChange={(e) => handleRoleChange(a, e.target.value)}
                      sx={{ fontSize: '0.8rem', minWidth: 90 }}
                    >
                      <MenuItem value="user">user</MenuItem>
                      <MenuItem value="admin">admin</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Button size="small" variant="outlined"
                        onClick={() => { setResetTarget(a); setResetPw(''); setResetError(''); }}
                        sx={{ fontSize: '0.72rem' }}
                      >Reset PW</Button>
                      {a.email !== currentEmail && (
                        <Button size="small" variant="outlined" color="info"
                          onClick={() => onImpersonate(a.id)}
                          sx={{ fontSize: '0.72rem' }}
                        >Login as</Button>
                      )}
                      {a.email !== currentEmail && (
                        <Button size="small" variant="outlined" color="error"
                          onClick={() => setDelTarget(a)}
                          sx={{ fontSize: '0.72rem' }}
                        >Delete</Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Reset Password dialog */}
      {resetTarget && (
        <Dialog open onClose={() => setResetTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Reset password — {resetTarget.email}</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            {resetError && <Typography color="error" variant="body2" sx={{ mb: 1 }}>{resetError}</Typography>}
            <TextField fullWidth size="small" type="password" label="New password (min 8 chars)"
              value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoFocus />
          </DialogContent>
          <DialogActions sx={{ p: 2, gap: 1 }}>
            <Button onClick={() => setResetTarget(null)} sx={{ flex: 1 }}>Cancel</Button>
            <Button variant="contained" onClick={handleResetPassword} disabled={resetPw.length < 8} sx={{ flex: 1 }}>Save</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Delete confirmation dialog */}
      {delTarget && (
        <Dialog open onClose={() => setDelTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Delete account?</DialogTitle>
          <DialogContent>
            <Typography>Remove <strong>{delTarget.email}</strong>? This cannot be undone.</Typography>
          </DialogContent>
          <DialogActions sx={{ p: 2, gap: 1 }}>
            <Button onClick={() => setDelTarget(null)} sx={{ flex: 1 }}>Cancel</Button>
            <Button variant="contained" color="error" onClick={handleDelete} sx={{ flex: 1 }}>Delete</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

export default function App() {
  const [role, setRole]           = useState('loading'); // 'loading'|'guest'|'user'|'admin'
  const [user, setUser]           = useState(null);
  const [breeds, setBreeds]       = useState([]);
  const [myHerd, setMyHerd]       = useState([]); // full breed copies, server-persisted
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editContext, setEditContext] = useState(null); // 'master' | 'myherd'
  const [tab, setTab]             = useState(0);
  const [tagFilter, setTagFilter] = useState(null);
  const [addOpen, setAddOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [avatarMenu, setAvatarMenu] = useState(null);

  const isAdmin = role === 'admin';
  const isUser  = role === 'user' || role === 'admin';

  // ── Init: check session + load breeds (guests can browse) ──────────────────
  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((data) => {
        const loggedIn = data.role && data.role !== 'guest';
        if (loggedIn) { setUser(data); setRole(data.role); setImpersonating(!!data.impersonating); }
        else { setRole('guest'); }
        return fetch('/api/breeds')
          .then((r) => r.json())
          .then((masterData) => {
            setBreeds(masterData);
            if (loggedIn) {
              return fetch('/api/myherd').then((r) => r.json()).then(setMyHerd);
            }
          });
      })
      .catch(() => {
        setRole('guest');
        fetch('/api/breeds').then((r) => r.json()).then(setBreeds).catch(() => {});
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Handle successful login / register ─────────────────────────────────────
  const handleAuth = async (data) => {
    setUser(data);
    setRole(data.role);
    setShowLogin(false);
    fetch('/api/myherd').then((r) => r.json()).then(setMyHerd).catch(() => {});
  };

  // ── Handle unimpersonate (return to admin) ─────────────────────────────────
  const handleUnimpersonate = async () => {
    const resp = await fetch('/api/unimpersonate', { method: 'POST' });
    const data = await resp.json();
    setUser(data); setRole(data.role); setImpersonating(false);
    setMyHerd([]); setTab(0);
    fetch('/api/myherd').then((r) => r.json()).then(setMyHerd).catch(() => {});
  };

  // ── Handle logout ──────────────────────────────────────────────────────────
  const handleLogout = async () => {
    if (impersonating) { await handleUnimpersonate(); return; }
    await fetch('/api/logout', { method: 'POST' });
    setUser(null); setRole('guest'); setMyHerd([]); setTab(0);
  };

  // ── Handle impersonate ─────────────────────────────────────────────────────
  const handleImpersonate = async (accountId) => {
    const resp = await fetch(`/api/impersonate/${accountId}`, { method: 'POST' });
    const data = await resp.json();
    setUser(data); setRole(data.role); setImpersonating(true);
    setMyHerd([]); setTab(0); setShowAccounts(false);
    fetch('/api/myherd').then((r) => r.json()).then(setMyHerd).catch(() => {});
  };

  // myList is a Set of IDs (or names for legacy items) for O(1) lookup
  const myList = useMemo(() => new Set(myHerd.map((b) => b.id ?? b.name)), [myHerd]);

  // ── All unique tags across master breeds (for filter bar + autocomplete) ───
  const allTags = useMemo(() => {
    const counts = new Map();
    breeds.forEach((b) => (b.tags || []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [breeds]);

  // ── Save my herd to server ──────────────────────────────────────────────────
  const saveMyHerd = useCallback(async (nextHerd) => {
    setMyHerd(nextHerd);
    await fetch('/api/myherd', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextHerd),
    });
  }, []); // setMyHerd is stable; fetch is global — no deps needed

  // Use a ref updated after render so toggle's useCallback stays stable across myHerd changes
  const myHerdRef = useRef(myHerd);
  useEffect(() => { myHerdRef.current = myHerd; });

  // ── Toggle a breed in My Herd (add full copy / remove) ─────────────────────
  const toggle = useCallback((breed) => {
    if (!isUser) { setShowLogin(true); return; }
    const key = breed.id ?? breed.name;
    const herd = myHerdRef.current;
    const nextHerd = herd.some((b) => (b.id ?? b.name) === key)
      ? herd.filter((b) => (b.id ?? b.name) !== key)
      : [...herd, { ...breed }];
    saveMyHerd(nextHerd);
  }, [isUser, saveMyHerd]);

  // ── Edit handler (stable ref for memo) ───────────────────────────────────────
  const handleEditBreed = useCallback((breed) => {
    setEditTarget(breed);
    setEditContext(tab === 1 ? 'myherd' : (isAdmin ? 'master' : 'myherd'));
  }, [tab, isAdmin]);

  // ── Save breed edit ─────────────────────────────────────────────────────────
  const saveBreed = async (updated, originalName) => {
    if (editContext === 'master') {
      // Admin: patch master list
      await fetch(`/api/breeds/${updated.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      setBreeds((prev) => prev.map((b) => b.id === updated.id ? updated : b));
      // If this breed is in user's herd, keep the herd copy independent (no propagation)
    } else {
      // My Herd edit: update private copy only
      const nextHerd = myHerd.map((b) =>
        (b.id ?? b.name) === (updated.id ?? originalName) ? { ...b, ...updated } : b
      );
      await saveMyHerd(nextHerd);
    }
    setEditTarget(null);
    setEditContext(null);
  };

  // ── Admin: add new breed ────────────────────────────────────────────────────
  const addBreed = async (fields) => {
    const resp = await fetch('/api/breeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const newBreed = await resp.json();
    setBreeds((prev) => [...prev, newBreed]);
    setAddOpen(false);
  };

  // ── Admin: delete breed from master ────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await fetch(`/api/breeds/${deleteTarget.id}`, { method: 'DELETE' });
    setBreeds((prev) => prev.filter((b) => b.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  // ── JSON export / import ────────────────────────────────────────────────────
  const importFileRef = useRef(null);
  const importContextRef = useRef(null); // 'master' | 'myherd'

  const exportJson = (list, filename) => {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const triggerImport = (context) => {
    importContextRef.current = context;
    importFileRef.current.value = '';
    importFileRef.current.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) { alert('Invalid file: expected a JSON array.'); return; }
      if (importContextRef.current === 'master') {
        const resp = await fetch('/api/breeds/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const result = await resp.json();
        if (!resp.ok) { alert('Import failed: ' + result.error); return; }
        setBreeds(data);
      } else {
        await saveMyHerd(data);
      }
    } catch (err) {
      alert('Failed to parse file: ' + err.message);
    }
  };

  const exportMd = (list, filename = 'cattle-breeds.md') => {
    const rows = list.map((b) => {
      const img = b.imageUrl ? `![${b.name}](${b.imageUrl})` : '';
      return `| ${b.name} | ${img} | ${b.origin || ''} | ${b.subspecies || ''} | ${(b.tags || []).join(', ')} | ${b.wikiUrl ? `[link](${b.wikiUrl})` : ''} |`;
    }).join('\n');
    const md = `# Cattle Breeds\n\n| Name | Image | Origin | Subspecies | Tags | Wikipedia |\n|------|-------|--------|------------|------|----------|\n${rows}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDocx = async (list, filename = 'cattle-breeds.docx') => {
    const fetchImageBytes = async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
      } catch { return null; }
    };

    const headerRow = new DocxTableRow({
      children: ['Name', 'Origin', 'Subspecies', 'Tags', 'Wikipedia'].map(
        (h) => new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
      ),
    });

    const dataRows = await Promise.all(list.map(async (b) => {
      let imgCell;
      if (b.imageUrl) {
        const bytes = await fetchImageBytes(b.imageUrl);
        imgCell = bytes
          ? new DocxTableCell({ children: [new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width: 80, height: 60 } })] })] })
          : new DocxTableCell({ children: [new Paragraph({ children: [new TextRun(b.imageUrl)] })] });
      } else {
        imgCell = new DocxTableCell({ children: [new Paragraph('')] });
      }
      return new DocxTableRow({
        children: [
          new DocxTableCell({ children: [new Paragraph(b.name || '')] }),
          imgCell,
          new DocxTableCell({ children: [new Paragraph(b.origin || '')] }),
          new DocxTableCell({ children: [new Paragraph(b.subspecies || '')] }),
          new DocxTableCell({ children: [new Paragraph((b.tags || []).join(', '))] }),
          new DocxTableCell({ children: [new Paragraph(b.wikiUrl || '')] }),
        ],
      });
    }));

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Cattle Breeds', heading: HeadingLevel.HEADING_1 }),
          new DocxTable({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...dataRows],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const base = tab === 1 ? myHerd : breeds;
    return base.filter((b) => {
      const matchesSearch = !q ||
        b.name.toLowerCase().includes(q) ||
        (b.origin && b.origin.toLowerCase().includes(q)) ||
        (b.tags || []).some((t) => t.toLowerCase().includes(q));
      const matchesTag = !tagFilter || (b.tags || []).includes(tagFilter);
      return matchesSearch && matchesTag;
    });
  }, [breeds, myHerd, search, tab, tagFilter]);

  const selectionList = myHerd;

  if (role === 'loading') return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#1b4332' }}>
      <CircularProgress sx={{ color: '#74c69d' }} />
    </Box>
  );

  if (showLogin) return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LoginPage onAuth={handleAuth} />
      <Box sx={{ textAlign: 'center', mt: -2, pb: 3 }}>
        <Button variant="text" size="small" onClick={() => setShowLogin(false)}>← Back to browsing</Button>
      </Box>
    </ThemeProvider>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>

        {/* ── Nav bar ── */}
        <AppBar position="sticky" sx={{ bgcolor: '#1b4332', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Toolbar sx={{ gap: 1, flexWrap: 'wrap', py: { xs: 0.5, sm: 0 } }}>
            <Typography variant="h6" sx={{ mr: 1, whiteSpace: 'nowrap', display: { xs: 'none', sm: 'block' } }}>🐄 HerdHub</Typography>
            <Typography variant="h6" sx={{ mr: 1, whiteSpace: 'nowrap', display: { xs: 'block', sm: 'none' } }}>🐄</Typography>
            <Tabs
              value={tab}
              onChange={(_, v) => { if (v === 1 && !isUser) { setShowLogin(true); return; } setTab(v); setTagFilter(null); }}
              textColor="inherit"
              TabIndicatorProps={{ style: { backgroundColor: '#74c69d', height: 3, borderRadius: 2 } }}
              sx={{ flexGrow: 1, minHeight: 48 }}
            >
              <Tab label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>All</Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>All</Box>
                  <Box component="span" sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: '#d8f3dc', borderRadius: '999px', px: 0.9, py: 0.1, fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.6 }}>
                    {breeds.length}
                  </Box>
                </Box>
              } sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }} />
              <Tab label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>My Herd</Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>🔖</Box>
                  {myHerd.length > 0 && (
                    <Box component="span" sx={{ bgcolor: '#e63946', color: '#fff', borderRadius: '999px', px: 0.9, py: 0.1, fontSize: '0.7rem', fontWeight: 700, lineHeight: 1.6 }}>
                      {myHerd.length}
                    </Box>
                  )}
                </Box>
              } sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }} />
            </Tabs>
            {/* Auth controls */}
            {isUser ? (
              <>
                <Tooltip title={user?.email}>
                  <Avatar
                    onClick={(e) => setAvatarMenu(e.currentTarget)}
                    sx={{ width: 30, height: 30, bgcolor: impersonating ? '#d97706' : '#40916c', fontSize: '0.8rem', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {user?.email?.[0]?.toUpperCase()}
                  </Avatar>
                </Tooltip>
                <Menu anchorEl={avatarMenu} open={Boolean(avatarMenu)} onClose={() => setAvatarMenu(null)}>
                  {isAdmin && !impersonating && (
                    <MenuItem onClick={() => { setAvatarMenu(null); setShowAccounts(true); }}>
                      <PeopleIcon sx={{ mr: 1.5, fontSize: '1.1rem' }} /> Manage Accounts
                    </MenuItem>
                  )}
                  <MenuItem onClick={() => { setAvatarMenu(null); handleLogout(); }}>
                    <LogoutIcon sx={{ mr: 1.5, fontSize: '1.1rem' }} />
                    {impersonating ? 'Return to admin' : 'Sign out'}
                  </MenuItem>
                </Menu>
              </>
            ) : (
              <Button size="small" variant="outlined"
                onClick={() => setShowLogin(true)}
                sx={{ color: '#74c69d', borderColor: '#74c69d', fontSize: '0.72rem', flexShrink: 0 }}
              >Sign in</Button>
            )}
          </Toolbar>
        </AppBar>

        {/* ── Impersonation banner ── */}
        {impersonating && (
          <Box sx={{ bgcolor: '#d97706', color: 'white', py: 0.75, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              👤 Viewing as {user?.email}
            </Typography>
            <Button size="small" variant="outlined" onClick={handleUnimpersonate}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.6)', fontSize: '0.72rem' }}
            >Return to admin</Button>
          </Box>
        )}

        {/* ── Hero search ── */}
        {showAccounts ? (
          <AccountsPage
            onClose={() => setShowAccounts(false)}
            onImpersonate={handleImpersonate}
            currentEmail={user?.email}
          />
        ) : (<>
        <Box sx={{ background: 'linear-gradient(160deg, #1b4332 0%, #2d6a4f 60%, #40916c 100%)', py: 4, px: 2 }}>
          <Container maxWidth="md">
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)', mb: 1, textAlign: 'center' }}>
              {filtered.length} of {tab === 1 ? myHerd.length : breeds.length} breeds
            </Typography>
            <TextField
              fullWidth
              placeholder="Search by name, origin or purpose…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)',
                  color: 'white', borderRadius: 3,
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
                  '&.Mui-focused fieldset': { borderColor: 'white' },
                },
                '& .MuiInputAdornment-root svg': { color: 'rgba(255,255,255,0.6)' },
                input: { color: 'white', '&::placeholder': { color: 'rgba(255,255,255,0.45)', opacity: 1 } },
              }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
              {allTags.map((t) => {
                const label = t.length > 10 ? t.slice(0, 10) + '…' : t;
                return (
                  <Chip
                    key={t} label={label} title={t.length > 10 ? t : undefined}
                    onClick={() => setTagFilter((prev) => prev === t ? null : t)}
                    variant={tagFilter === t ? 'filled' : 'outlined'}
                    sx={{
                      color: tagFilter === t ? '#1b4332' : 'rgba(255,255,255,0.85)',
                      bgcolor: tagFilter === t ? '#74c69d' : 'transparent',
                      borderColor: 'rgba(255,255,255,0.3)', fontWeight: 600,
                      '&:hover': { bgcolor: tagFilter === t ? '#74c69d' : 'rgba(255,255,255,0.12)' },
                    }}
                  />
                );
              })}
            </Box>
          </Container>
        </Box>

        {/* ── Content ── */}
        <Container maxWidth="xl" sx={{ py: 4 }}>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <>
              {/* ── Per-tab toolbar ── */}
              <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                {tab === 0 && (
                  <>
                    {/* Export All as JSON */}
                    <Button variant="outlined" startIcon={<DownloadIcon />}
                      onClick={() => exportJson(breeds, 'all-breeds.json')}
                    >Export JSON ({breeds.length})</Button>
                    {/* Import All — admin only */}
                    {isAdmin && (
                      <Button variant="outlined" startIcon={<UploadIcon />}
                        onClick={() => triggerImport('master')}
                      >Import JSON</Button>
                    )}
                    {/* Add breed — admin only */}
                    {isAdmin && (
                      <Button variant="outlined" startIcon={<AddIcon />}
                        onClick={() => setAddOpen(true)}
                      >Add breed</Button>
                    )}
                  </>
                )}
                {tab === 1 && (
                  <>
                    {/* Export My Herd as JSON */}
                    <Button variant="outlined" startIcon={<DownloadIcon />}
                      onClick={() => exportJson(myHerd, 'my-herd.json')}
                      disabled={myHerd.length === 0}
                    >Export JSON ({myHerd.length})</Button>
                    {/* Import My Herd */}
                    <Button variant="outlined" startIcon={<UploadIcon />}
                      onClick={() => triggerImport('myherd')}
                    >Import JSON</Button>
                    {/* Existing .md / .docx exports */}
                    <Button variant="outlined" startIcon={<DownloadIcon />}
                      onClick={() => exportMd(selectionList, 'my-selection.md')}
                      disabled={myHerd.length === 0}
                    >Export .md</Button>
                    <Button variant="contained" startIcon={<DownloadIcon />}
                      onClick={() => exportDocx(selectionList, 'my-selection.docx')}
                      disabled={myHerd.length === 0}
                    >Export .docx</Button>
                  </>
                )}
              </Box>
              <BreedGrid
                breeds={filtered}
                myList={myList}
                onCardClick={setSelected}
                onToggle={toggle}
                onEdit={handleEditBreed}
                showEdit={tab === 1 || isAdmin}
              />
            </>
          )}
        </Container>
        </>)}

        {/* ── Dialogs ── */}
        <BreedDialog
          breed={selected}
          onClose={() => setSelected(null)}
          onEdit={(breed) => {
            setEditTarget(breed);
            setEditContext(tab === 1 ? 'myherd' : (isAdmin ? 'master' : 'myherd'));
          }}
          onToggle={() => selected && toggle(selected)}
          inMyList={selected ? myList.has(selected.id ?? selected.name) : false}
          showEdit={tab === 1 || isAdmin}
        />
        {editTarget && (
          <EditDialog breed={editTarget} onClose={() => { setEditTarget(null); setEditContext(null); }} onSave={saveBreed} allTags={allTags} />
        )}

        {/* Admin: add breed dialog */}
        {addOpen && (
          <AddBreedDialog onClose={() => setAddOpen(false)} onSave={addBreed} allTags={allTags} />
        )}

        {/* Admin: delete confirmation */}
        {deleteTarget && (
          <Dialog open onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
            <DialogTitle>Delete breed?</DialogTitle>
            <DialogContent>
              <Typography>Remove <strong>{deleteTarget.name}</strong> from the master list? This cannot be undone.</Typography>
            </DialogContent>
            <DialogActions sx={{ p: 2, gap: 1 }}>
              <Button onClick={() => setDeleteTarget(null)} sx={{ flex: 1 }}>Cancel</Button>
              <Button variant="contained" color="error" onClick={confirmDelete} sx={{ flex: 1 }}>Delete</Button>
            </DialogActions>
          </Dialog>
        )}
        {/* Hidden file input for JSON import */}
        <input
          ref={importFileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </Box>
    </ThemeProvider>
  );
}