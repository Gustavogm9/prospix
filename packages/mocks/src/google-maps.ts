import { http, HttpResponse } from 'msw';

const fakePlaces = [
  {
    place_id: 'mock_place_001',
    displayName: { text: 'Dr. Roberto Lima · Cardiologia' },
    formattedAddress: 'Av. Brigadeiro Faria Lima, 1000, São José do Rio Preto, SP',
    nationalPhoneNumber: '(17) 3232-1010',
    rating: 4.7,
    userRatingCount: 184,
    types: ['doctor', 'health'],
  },
  {
    place_id: 'mock_place_002',
    displayName: { text: 'Dra. Camila Souza · Ortopedia' },
    formattedAddress: 'Rua Bernardino de Campos, 234, São José do Rio Preto, SP',
    nationalPhoneNumber: '(17) 99887-6622',
    rating: 4.9,
    userRatingCount: 92,
    types: ['doctor', 'health'],
  },
];

export const googleMapsHandlers = [
  http.post('https://places.googleapis.com/v1/places:searchText', () =>
    HttpResponse.json({ places: fakePlaces }),
  ),
  http.get('https://places.googleapis.com/v1/places/:place_id', ({ params }) => {
    const place = fakePlaces.find((p) => p.place_id === params.place_id);
    if (!place) return HttpResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return HttpResponse.json(place);
  }),
];

export const googleMapsFixtures = { fakePlaces };
