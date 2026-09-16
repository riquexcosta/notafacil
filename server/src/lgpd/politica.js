/**
 * Política de privacidade do NotaFácil (Lei nº 13.709/2018, LGPD).
 * Qualquer mudança de conteúdo exige nova VERSAO_POLITICA: usuários que aceitaram
 * uma versão anterior precisam aceitar a nova antes de continuar usando o sistema.
 */
export const VERSAO_POLITICA = '1.0';

export const POLITICA = {
  versao: VERSAO_POLITICA,
  vigenteDesde: '2026-09-13',
  controlador: {
    nome: 'Henrique Gonsalves Costa',
    papel: 'Controlador e encarregado pelo tratamento de dados pessoais',
    contato: 'riquegonsalves@gmail.com'
  },
  secoes: [
    {
      titulo: '1. Quem trata os seus dados',
      paragrafos: [
        'O controlador dos dados pessoais tratados pelo NotaFácil é Henrique Gonsalves Costa, que também atua como encarregado pelo tratamento de dados pessoais (art. 41 da LGPD). Pedidos, dúvidas e reclamações podem ser enviados para riquegonsalves@gmail.com.'
      ]
    },
    {
      titulo: '2. Quais dados são tratados',
      paragrafos: [
        'Dados da conta: nome, e-mail, senha e a versão e a data do aceite desta política. A senha nunca é guardada: o sistema armazena apenas o resultado de uma função de hash (bcrypt), que não permite recuperá-la.',
        'Dados das compras que você registra: chave de acesso da nota, estabelecimento emitente (CNPJ, razão social e endereço), data e hora de emissão, itens (descrição, código de barras, classificação fiscal, quantidade e valores), tributos aproximados e a forma como a nota foi registrada.',
        'O NotaFácil não grava o CPF do consumidor. Quando ele aparece no XML da nota ou na resposta do serviço de consulta, é descartado antes da gravação. Também não são coletados localização, contatos ou dados de pagamento.'
      ]
    },
    {
      titulo: '3. Para que os dados são usados',
      paragrafos: [
        'Os dados servem exclusivamente para montar o seu histórico de preços, comparar cada compra com as suas compras anteriores e entre os estabelecimentos em que você comprou, e calcular os indicadores exibidos no painel.',
        'Os dados não são vendidos, não são usados para publicidade e não são combinados com dados de outros usuários. Cada usuário vê apenas as notas, os produtos e os preços das próprias compras.'
      ]
    },
    {
      titulo: '4. Bases legais',
      paragrafos: [
        'Os dados da conta e das compras são tratados para executar o serviço que você solicitou ao criar a conta (art. 7º, inciso V, da LGPD).',
        'Compras de medicamentos ou produtos de saúde podem revelar dados pessoais sensíveis (art. 5º, inciso II). Esses dados são tratados com o seu consentimento específico e destacado, dado no cadastro (art. 11, inciso I), apenas para exibição no seu próprio histórico. Você pode revogar esse consentimento excluindo as notas correspondentes ou a sua conta.'
      ]
    },
    {
      titulo: '5. Compartilhamento e transferência internacional',
      paragrafos: [
        'Quando a consulta automática está habilitada, a chave de acesso da nota é enviada à Infosimples Processamento de Dados Ltda., que consulta o portal da Secretaria da Fazenda e devolve os dados da nota. A Infosimples atua como operadora e recebe apenas a chave de acesso, sem nome, e-mail ou qualquer dado da sua conta.',
        'Os comprovantes dessas consultas são armazenados pela Infosimples em infraestrutura de nuvem do Google hospedada nos Estados Unidos, o que caracteriza transferência internacional de dados (art. 33 da LGPD).',
        'Na consulta assistida, você acessa diretamente o portal oficial da Secretaria da Fazenda, e o NotaFácil não envia dados a ninguém. Não há outro compartilhamento.'
      ]
    },
    {
      titulo: '6. Por quanto tempo os dados ficam guardados',
      paragrafos: [
        'Os dados são mantidos enquanto a sua conta existir. Você pode excluir uma nota a qualquer momento, e ela é apagada com seus itens e preços.',
        'Ao excluir a conta, são apagados imediatamente a conta, todas as notas, itens e preços. Produtos e estabelecimentos que não constem em notas de outros usuários também são removidos. Esta versão do sistema não mantém cópias de segurança automáticas.'
      ]
    },
    {
      titulo: '7. Segurança',
      paragrafos: [
        'O acesso exige autenticação, e cada consulta ao banco de dados é filtrada pelo usuário autenticado. A sessão usa um token assinado com validade de 24 horas, as tentativas de login são limitadas e a senha exige ao menos 8 caracteres.',
        'Em produção, o sistema só pode ser executado com um segredo de assinatura próprio e deve ser acessado por HTTPS. O token de sessão fica no armazenamento local do navegador e é apagado ao sair da conta.'
      ]
    },
    {
      titulo: '8. Seus direitos',
      paragrafos: [
        'A LGPD garante a você, entre outros, os direitos de confirmação e acesso, correção, eliminação, portabilidade, informação sobre compartilhamento e revogação do consentimento (art. 18). No NotaFácil, a página Minha conta permite baixar todos os seus dados em um arquivo JSON, corrigir nome e e-mail, e excluir a conta. Notas podem ser excluídas na tela de detalhe de cada uma.',
        'Os demais pedidos podem ser feitos pelo e-mail do encarregado. Você também pode apresentar petição à Autoridade Nacional de Proteção de Dados (ANPD).'
      ]
    },
    {
      titulo: '9. Alterações desta política',
      paragrafos: [
        'Mudanças nesta política recebem um novo número de versão. Quando isso acontecer, o sistema pedirá que você leia e aceite a nova versão antes de continuar.'
      ]
    }
  ]
};
