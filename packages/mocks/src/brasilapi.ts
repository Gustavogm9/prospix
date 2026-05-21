import { http, HttpResponse } from 'msw';

export const mockCnpjData: Record<string, any> = {
  '12345678000199': {
    cnpj: '12345678000199',
    razao_social: 'MOCK CLINIC LTDA',
    nome_fantasia: 'CLINICA MOCK',
    situacao_cadastral: 2, // Active
    data_inicio_atividade: '2015-10-21',
    cnae_fiscal: 8621601,
    uf: 'SP',
    municipio: 'SAO JOSE DO RIO PRETO',
    bairro: 'CENTRO',
    qsa: [
      { nome_socio: 'DR. ROBERTO LIMA', qualificacao_socio_descricao: 'Sócio-Administrador' }
    ]
  },
  '98765432000188': {
    cnpj: '98765432000188',
    razao_social: 'MOCK LAWYERS ASSOCIATED',
    situacao_cadastral: 2,
    data_inicio_atividade: '2018-05-12',
    cnae_fiscal: 6911701,
    uf: 'SP',
    municipio: 'SAO JOSE DO RIO PRETO',
    bairro: 'REDENTORA',
    qsa: [
      { nome_socio: 'DRA. CAMILA SOUZA', qualificacao_socio_descricao: 'Sócio' }
    ]
  }
};

export const mockReceitaWsData: Record<string, any> = {
  // Used for testing fallback when BrasilAPI returns 500 for a specific CNPJ
  '55555555000155': {
    status: 'OK',
    cnpj: '55555555000155',
    nome: 'FALLBACK CLINIC CLINICAL SERVICES',
    fantasia: 'FALLBACK CLINIC',
    situacao: 'ATIVA',
    abertura: '21/10/2015',
    atividade_principal: [{ code: '86.21-6-01', text: 'Cardiologia' }],
    uf: 'SP',
    municipio: 'SAO JOSE DO RIO PRETO',
    bairro: 'CENTRO',
    qsa: [{ nome: 'DR. ROBERTO LIMA', qual: 'Sócio-Administrador' }]
  }
};

export const brasilApiHandlers = [
  // BrasilAPI mock
  http.get('https://brasilapi.com.br/api/cnpj/v1/:cnpj', ({ params }) => {
    const cnpj = params.cnpj as string;
    
    // Simulate 500 Internal Error to test ReceitaWS fallback
    if (cnpj === '55555555000155') {
      return new HttpResponse(null, { status: 500 });
    }

    const data = mockCnpjData[cnpj];
    if (!data) {
      return HttpResponse.json({ message: 'CNPJ não encontrado' }, { status: 404 });
    }

    return HttpResponse.json(data);
  }),

  // ReceitaWS mock
  http.get('https://receitaws.com.br/v1/cnpj/:cnpj', ({ params }) => {
    const cnpj = params.cnpj as string;

    const data = mockReceitaWsData[cnpj];
    if (!data) {
      return HttpResponse.json({ status: 'ERROR', message: 'CNPJ inválido ou não encontrado' }, { status: 404 });
    }

    return HttpResponse.json(data);
  })
];
