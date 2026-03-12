import { useEffect, useMemo, useRef, useState } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import {
  AppBar,
  Badge,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CssBaseline,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  Tab,
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
import EditIcon from '@mui/icons-material/Edit';
import {
  Document, Paragraph, Table, TableCell, TableRow,
  TextRun, ImageRun, WidthType, HeadingLevel, Packer,
} from 'docx';

// ── Theme ──────────────────────────────────────────────────────────────────
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

const MYLIST_KEY = 'cowMyList';
const loadMyList = () => {
  try { return new Set(JSON.parse(localStorage.getItem(MYLIST_KEY) || '[]')); }
  catch { return new Set(); }
};

const STORAGE_KEY = 'cowBreedEdits';
const loadEdits = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
};

const PURPOSE_META = {
  Meat:    { color: '#e63946', bg: '#fdecea' },
  Dairy:   { color: '#457b9d', bg: '#e8f4f8' },
  Draught: { color: '#b5651d', bg: '#fef3e2' },
  Other:   { color: '#6c757d', bg: '#f0f0f0' },
};

function PurposeChips({ purpose, size = 'small' }) {
  if (!purpose) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {purpose.split('/').map((p) => {
        const key = Object.keys(PURPOSE_META).find((k) => p.includes(k)) ?? 'Other';
        const meta = PURPOSE_META[key];
        return (
          <Chip
            key={p}
            label={p}
            size={size}
            sx={{
              fontSize: '0.65rem',
              color: meta.color,
              bgcolor: meta.bg,
              border: `1px solid ${meta.color}33`,
              fontWeight: 600,
            }}
          />
        );
      })}
    </Box>
  );
}

function BreedCard({ breed, inMyList, onCardClick, onToggle, onEdit }) {
  const [imgErr, setImgErr] = useState(false);
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
        onClick={onCardClick}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box sx={{ position: 'relative', overflow: 'hidden' }}>
          {breed.imageUrl && !imgErr ? (
            <CardMedia
              component="img"
              height="180"
              image={breed.imageUrl}
              alt={breed.name}
              onError={() => setImgErr(true)}
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
          <PurposeChips purpose={breed.purpose} />
        </CardContent>
      </CardActionArea>
      <Divider sx={{ mx: 1.5, opacity: 0.4 }} />
      <Box sx={{ px: 1, py: 0.5, display: 'flex', justifyContent: 'space-between' }}>
        <Tooltip title="Edit breed">
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
            <EditIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={inMyList ? 'Remove from My Selection' : 'Add to My Selection'}>
          <IconButton
            size="small"
            sx={{ color: inMyList ? '#2d6a4f' : 'text.secondary' }}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {inMyList ? <BookmarkRemoveIcon sx={{ fontSize: 18 }} /> : <BookmarkAddIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Card>
  );
}

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

function BreedDialog({ breed, onClose, onEdit, onToggle, inMyList }) {
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
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => { onClose(); onEdit(breed); }}><EditIcon /></IconButton>
            </Tooltip>
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
          {breed.purpose && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} letterSpacing={0.8} sx={{ textTransform: 'uppercase', display: 'block', mb: 0.5 }}>Purpose</Typography>
              <PurposeChips purpose={breed.purpose} size="medium" />
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

function EditDialog({ breed, onClose, onSave }) {
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
        <TextField fullWidth label="Purpose (e.g. Meat/Dairy)" size="small" value={form.purpose || ''} onChange={set('purpose')} />
        <TextField fullWidth label="Wikipedia URL" size="small" value={form.wikiUrl || ''} onChange={set('wikiUrl')} />
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

function BreedGrid({ breeds, myList, onCardClick, onToggle, onEdit }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  // Reset when the list changes (new search / filter / tab)
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [breeds]);

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
            key={breed.name}
            breed={breed}
            inMyList={myList.has(breed.name)}
            onCardClick={() => onCardClick(breed)}
            onToggle={() => onToggle(breed.name)}
            onEdit={() => onEdit(breed)}
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

export default function App() {
  const [breeds, setBreeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [tab, setTab] = useState(0);
  const [myList, setMyList] = useState(() => loadMyList());
  const [purposeFilter, setPurposeFilter] = useState(null);

  useEffect(() => {
    fetch('/api/breeds')
      .then((r) => r.json())
      .then((data) => {
        const edits = loadEdits();
        setBreeds(data.map((b) => ({ ...b, ...(edits[b.name] || {}) })));
        setLoading(false);
      });
  }, []);

  const saveBreed = (updated, originalName) => {
    const edits = loadEdits();
    if (updated.name !== originalName) delete edits[originalName];
    edits[updated.name] = updated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    setBreeds((prev) => prev.map((b) => b.name === originalName ? updated : b));
    setEditTarget(null);
  };

  const downloadBreedsJson = async () => {
    // Save to server (persists in volume across redeploys)
    try {
      await fetch('/api/save-breeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(breeds),
      });
    } catch (err) {
      console.error('Server save failed', err);
    }
    // Also download locally as backup
    const blob = new Blob([JSON.stringify(breeds, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'breeds.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (name) => {
    setMyList((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      localStorage.setItem(MYLIST_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const exportMd = (list, filename = 'cattle-breeds.md') => {
    const rows = list.map((b) => {
      const img = b.imageUrl ? `![${b.name}](${b.imageUrl})` : '';
      return `| ${b.name} | ${img} | ${b.origin || ''} | ${b.subspecies || ''} | ${b.purpose || ''} | ${b.wikiUrl ? `[link](${b.wikiUrl})` : ''} |`;
    }).join('\n');
    const md = `# Cattle Breeds\n\n| Name | Image | Origin | Subspecies | Purpose | Wikipedia |\n|------|-------|--------|------------|---------|----------|\n${rows}\n`;
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

    const headerRow = new TableRow({
      children: ['Name', 'Origin', 'Subspecies', 'Purpose', 'Wikipedia'].map(
        (h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
      ),
    });

    const dataRows = await Promise.all(list.map(async (b) => {
      let imgCell;
      if (b.imageUrl) {
        const bytes = await fetchImageBytes(b.imageUrl);
        imgCell = bytes
          ? new TableCell({ children: [new Paragraph({ children: [new ImageRun({ data: bytes, transformation: { width: 80, height: 60 } })] })] })
          : new TableCell({ children: [new Paragraph({ children: [new TextRun(b.imageUrl)] })] });
      } else {
        imgCell = new TableCell({ children: [new Paragraph('')] });
      }
      return new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(b.name || '')] }),
          imgCell,
          new TableCell({ children: [new Paragraph(b.origin || '')] }),
          new TableCell({ children: [new Paragraph(b.subspecies || '')] }),
          new TableCell({ children: [new Paragraph(b.purpose || '')] }),
          new TableCell({ children: [new Paragraph(b.wikiUrl || '')] }),
        ],
      });
    }));

    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: 'Cattle Breeds', heading: HeadingLevel.HEADING_1 }),
          new Table({
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
    const base = tab === 1 ? breeds.filter((b) => myList.has(b.name)) : breeds;
    return base.filter((b) => {
      const matchesSearch = !q ||
        b.name.toLowerCase().includes(q) ||
        (b.origin && b.origin.toLowerCase().includes(q)) ||
        (b.purpose && b.purpose.toLowerCase().includes(q));
      const matchesPurpose = !purposeFilter || (b.purpose && b.purpose.includes(purposeFilter));
      return matchesSearch && matchesPurpose;
    });
  }, [breeds, search, tab, myList, purposeFilter]);

  const selectionList = breeds.filter((b) => myList.has(b.name));

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
              onChange={(_, v) => { setTab(v); setPurposeFilter(null); }}
              textColor="inherit"
              TabIndicatorProps={{ style: { backgroundColor: '#74c69d', height: 3, borderRadius: 2 } }}
              sx={{ flexGrow: 1, minHeight: 48 }}
            >
              <Tab label={`All (${breeds.length})`} sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }} />
              <Tab label={
                <Badge badgeContent={myList.size} color="error" showZero={false} sx={{ pr: myList.size > 0 ? 1.5 : 0 }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>My Selection</Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>🔖</Box>
                </Badge>
              } />
            </Tabs>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              <Tooltip title="Export visible as .md">
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                  onClick={() => exportMd(filtered)}
                  sx={{ color: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.25)', fontSize: '0.72rem', minWidth: 0, px: { xs: 0.75, sm: 1.5 } }}
                ><Box sx={{ display: { xs: 'none', sm: 'inline' } }}>.md</Box></Button>
              </Tooltip>
              <Tooltip title="Export visible as .docx">
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
                  onClick={() => exportDocx(filtered)}
                  sx={{ color: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.25)', fontSize: '0.72rem', minWidth: 0, px: { xs: 0.75, sm: 1.5 } }}
                ><Box sx={{ display: { xs: 'none', sm: 'inline' } }}>.docx</Box></Button>
              </Tooltip>
              <Tooltip title="Download breeds.json with your edits">
                <Button size="small" variant="outlined"
                  onClick={downloadBreedsJson}
                  sx={{ color: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.25)', fontSize: '0.72rem', display: { xs: 'none', sm: 'flex' } }}
                >JSON</Button>
              </Tooltip>
            </Box>
          </Toolbar>
        </AppBar>

        {/* ── Hero search ── */}
        <Box sx={{ background: 'linear-gradient(160deg, #1b4332 0%, #2d6a4f 60%, #40916c 100%)', py: 4, px: 2 }}>
          <Container maxWidth="md">
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.55)', mb: 1, textAlign: 'center' }}>
              {filtered.length} of {breeds.length} breeds
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
              {['Meat', 'Dairy', 'Draught', 'Other'].map((p) => (
                <Chip
                  key={p} label={p}
                  onClick={() => setPurposeFilter((prev) => prev === p ? null : p)}
                  variant={purposeFilter === p ? 'filled' : 'outlined'}
                  sx={{
                    color: purposeFilter === p ? '#1b4332' : 'rgba(255,255,255,0.85)',
                    bgcolor: purposeFilter === p ? '#74c69d' : 'transparent',
                    borderColor: 'rgba(255,255,255,0.3)', fontWeight: 600,
                    '&:hover': { bgcolor: purposeFilter === p ? '#74c69d' : 'rgba(255,255,255,0.12)' },
                  }}
                />
              ))}
            </Box>
          </Container>
        </Box>

        {/* ── Content ── */}
        <Container maxWidth="xl" sx={{ py: 4 }}>
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <>
              {tab === 1 && (
                <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                  <Button variant="outlined" startIcon={<DownloadIcon />}
                    onClick={() => exportMd(selectionList, 'my-selection.md')}
                    disabled={myList.size === 0}
                  >Export .md ({myList.size})</Button>
                  <Button variant="contained" startIcon={<DownloadIcon />}
                    onClick={() => exportDocx(selectionList, 'my-selection.docx')}
                    disabled={myList.size === 0}
                  >Export .docx ({myList.size})</Button>
                </Box>
              )}
              <BreedGrid
                breeds={filtered}
                myList={myList}
                onCardClick={setSelected}
                onToggle={toggle}
                onEdit={setEditTarget}
              />
            </>
          )}
        </Container>

        <BreedDialog
          breed={selected}
          onClose={() => setSelected(null)}
          onEdit={setEditTarget}
          onToggle={() => selected && toggle(selected.name)}
          inMyList={selected ? myList.has(selected.name) : false}
        />
        {editTarget && (
          <EditDialog breed={editTarget} onClose={() => setEditTarget(null)} onSave={saveBreed} />
        )}
      </Box>
    </ThemeProvider>
  );
}


