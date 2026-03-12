import { useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Badge,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
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

const PURPOSE_COLORS = {
  Meat: 'error',
  Dairy: 'info',
  Draught: 'warning',
  Other: 'default',
};

function PurposeChips({ purpose }) {
  if (!purpose) return null;
  return purpose.split('/').map((p) => {
    const key = Object.keys(PURPOSE_COLORS).find((k) => p.includes(k)) ?? 'Other';
    return (
      <Chip
        key={p}
        label={p}
        size="small"
        color={PURPOSE_COLORS[key]}
        sx={{ mr: 0.5, mb: 0.5, fontSize: '0.65rem' }}
      />
    );
  });
}

function BreedCard({ breed, inMyList, onCardClick, onToggle }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.15s, box-shadow 0.15s',
        outline: inMyList ? '2px solid' : 'none',
        outlineColor: inMyList ? 'primary.main' : 'transparent',
        '&:hover': { transform: 'translateY(-4px)', boxShadow: 6 },
      }}
    >
      <CardActionArea
        onClick={onCardClick}
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box sx={{ position: 'relative' }}>
          {breed.imageUrl && !imgErr ? (
            <CardMedia
              component="img"
              height="180"
              image={breed.imageUrl}
              alt={breed.name}
              onError={() => setImgErr(true)}
              sx={{ objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={{
                height: 180,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'grey.100',
                color: 'grey.400',
                fontSize: '3rem',
              }}
            >
              🐄
            </Box>
          )}
          {inMyList && (
            <Box
              sx={{
                position: 'absolute',
                top: 6,
                left: 6,
                bgcolor: 'primary.main',
                color: 'white',
                borderRadius: '50%',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BookmarkAddedIcon sx={{ fontSize: 16 }} />
            </Box>
          )}
        </Box>
        <CardContent sx={{ flexGrow: 1, pb: '8px !important' }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom noWrap>
            {breed.name}
          </Typography>
          {breed.origin && (
            <Typography variant="body2" color="text.secondary" gutterBottom noWrap>
              📍 {breed.origin}
            </Typography>
          )}
          <Box sx={{ mt: 0.5 }}>
            <PurposeChips purpose={breed.purpose} />
          </Box>
        </CardContent>
      </CardActionArea>

      {/* Bookmark toggle button */}
      <Box sx={{ px: 1, pb: 1, textAlign: 'right' }}>
        <Tooltip title={inMyList ? 'Remove from My Selection' : 'Add to My Selection'}>
          <IconButton
            size="small"
            color={inMyList ? 'primary' : 'default'}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {inMyList ? <BookmarkRemoveIcon /> : <BookmarkAddIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Card>
  );
}

function BreedDialog({ breed, onClose }) {
  const [imgErr, setImgErr] = useState(false);
  if (!breed) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {breed.name}
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {breed.imageUrl && !imgErr ? (
          <Box
            component="img"
            src={breed.imageUrl}
            alt={breed.name}
            onError={() => setImgErr(true)}
            sx={{ width: '100%', maxHeight: 360, objectFit: 'contain', mb: 2, borderRadius: 1 }}
          />
        ) : (
          <Box sx={{ textAlign: 'center', fontSize: '5rem', mb: 2 }}>🐄</Box>
        )}
        {breed.origin && (
          <Typography variant="body1" gutterBottom>
            <strong>Origin:</strong> {breed.origin}
          </Typography>
        )}
        {breed.subspecies && (
          <Typography variant="body1" gutterBottom>
            <strong>Subspecies:</strong> {breed.subspecies}
          </Typography>
        )}
        {breed.purpose && (
          <Box sx={{ mt: 1, mb: 1 }}>
            <strong>Purpose: </strong>
            <PurposeChips purpose={breed.purpose} />
          </Box>
        )}
        {breed.wikiUrl && (
          <Box sx={{ mt: 2 }}>
            <a href={breed.wikiUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Wikipedia <OpenInNewIcon fontSize="small" />
            </a>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BreedGrid({ breeds, myList, onCardClick, onToggle }) {
  if (breeds.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
        <Typography variant="h4">🐄</Typography>
        <Typography variant="body1" sx={{ mt: 1 }}>No breeds here yet.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {breeds.map((breed) => (
        <Box key={breed.name} sx={{ width: 220, flexShrink: 0 }}>
          <BreedCard
            breed={breed}
            inMyList={myList.has(breed.name)}
            onCardClick={() => onCardClick(breed)}
            onToggle={() => onToggle(breed.name)}
          />
        </Box>
      ))}
    </Box>
  );
}

export default function App() {
  const [breeds, setBreeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState(0);
  const [myList, setMyList] = useState(() => new Set());

  useEffect(() => {
    fetch('/breeds.json')
      .then((r) => r.json())
      .then((data) => { setBreeds(data); setLoading(false); });
  }, []);

  const toggle = (name) => {
    setMyList((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = tab === 1 ? breeds.filter((b) => myList.has(b.name)) : breeds;
    return q
      ? list.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            (b.origin && b.origin.toLowerCase().includes(q)) ||
            (b.purpose && b.purpose.toLowerCase().includes(q))
        )
      : list;
  }, [breeds, search, tab, myList]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="sticky" color="primary" elevation={2}>
        <Toolbar>
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 3 }}>
            🐄 Cattle Breeds
          </Typography>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            textColor="inherit"
            TabIndicatorProps={{ style: { backgroundColor: 'white' } }}
            sx={{ flexGrow: 1 }}
          >
            <Tab label={`Index (${breeds.length})`} />
            <Tab
              label={
                <Badge badgeContent={myList.size} color="error" showZero={false}>
                  My Selection
                </Badge>
              }
            />
          </Tabs>
          <Typography variant="body2" sx={{ opacity: 0.8, ml: 2 }}>
            {filtered.length} shown
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <TextField
          fullWidth
          placeholder="Search by name, origin or purpose…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 3, bgcolor: 'white', borderRadius: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <BreedGrid
            breeds={filtered}
            myList={myList}
            onCardClick={setSelected}
            onToggle={toggle}
          />
        )}
      </Container>

      <BreedDialog breed={selected} onClose={() => setSelected(null)} />
    </Box>
  );
}

const PURPOSE_COLORS = {
  Meat: 'error',
  Dairy: 'info',
  Draught: 'warning',
  Other: 'default',
};

function PurposeChips({ purpose }) {
  if (!purpose) return null;
  return purpose.split('/').map((p) => {
    const key = Object.keys(PURPOSE_COLORS).find((k) => p.includes(k)) ?? 'Other';
    return (
      <Chip
        key={p}
        label={p}
        size="small"
        color={PURPOSE_COLORS[key]}
        sx={{ mr: 0.5, mb: 0.5, fontSize: '0.65rem' }}
      />
    );
  });
}

function BreedCard({ breed, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.15s, box-shadow 0.15s',
        '&:hover': { transform: 'translateY(-4px)', boxShadow: 6 },
      }}
    >
      <CardActionArea onClick={onClick} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        {breed.imageUrl && !imgErr ? (
          <CardMedia
            component="img"
            height="180"
            image={breed.imageUrl}
            alt={breed.name}
            onError={() => setImgErr(true)}
            sx={{ objectFit: 'cover' }}
          />
        ) : (
          <Box
            sx={{
              height: 180,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'grey.100',
              color: 'grey.400',
              fontSize: '3rem',
            }}
          >
            🐄
          </Box>
        )}
        <CardContent sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom noWrap>
            {breed.name}
          </Typography>
          {breed.origin && (
            <Typography variant="body2" color="text.secondary" gutterBottom>
              📍 {breed.origin}
            </Typography>
          )}
          <Box sx={{ mt: 0.5 }}>
            <PurposeChips purpose={breed.purpose} />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function BreedDialog({ breed, onClose }) {
  const [imgErr, setImgErr] = useState(false);
  if (!breed) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {breed.name}
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {breed.imageUrl && !imgErr ? (
          <Box
            component="img"
            src={breed.imageUrl}
            alt={breed.name}
            onError={() => setImgErr(true)}
            sx={{ width: '100%', maxHeight: 360, objectFit: 'contain', mb: 2, borderRadius: 1 }}
          />
        ) : (
          <Box sx={{ textAlign: 'center', fontSize: '5rem', mb: 2 }}>🐄</Box>
        )}

        {breed.origin && (
          <Typography variant="body1" gutterBottom>
            <strong>Origin:</strong> {breed.origin}
          </Typography>
        )}
        {breed.subspecies && (
          <Typography variant="body1" gutterBottom>
            <strong>Subspecies:</strong> {breed.subspecies}
          </Typography>
        )}
        {breed.purpose && (
          <Box sx={{ mt: 1, mb: 1 }}>
            <strong>Purpose: </strong>
            <PurposeChips purpose={breed.purpose} />
          </Box>
        )}
        {breed.wikiUrl && (
          <Box sx={{ mt: 2 }}>
            <a href={breed.wikiUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Wikipedia <OpenInNewIcon fontSize="small" />
            </a>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const [breeds, setBreeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch('/breeds.json')
      .then((r) => r.json())
      .then((data) => { setBreeds(data); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? breeds.filter(
          (b) =>
            b.name.toLowerCase().includes(q) ||
            (b.origin && b.origin.toLowerCase().includes(q)) ||
            (b.purpose && b.purpose.toLowerCase().includes(q))
        )
      : breeds;
  }, [breeds, search]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="sticky" color="primary" elevation={2}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            🐄 Cattle Breeds
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {filtered.length} / {breeds.length} breeds
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <TextField
          fullWidth
          placeholder="Search by name, origin or purpose…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 3, bgcolor: 'white', borderRadius: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {filtered.map((breed) => (
              <Box key={breed.name} sx={{ width: 220, flexShrink: 0 }}>
                <BreedCard breed={breed} onClick={() => setSelected(breed)} />
              </Box>
            ))}
          </Box>
        )}
      </Container>

      <BreedDialog breed={selected} onClose={() => setSelected(null)} />
    </Box>
  );
}
