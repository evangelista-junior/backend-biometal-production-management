const mongoose = require('mongoose');
var Schema = mongoose.Schema;

var ops = new Schema(
    {
        NUMEROOP: Number,
        CODIGO: String,
        DESCRICAO: String,
        QTDEPROGRAMADA: Number,
        DATAEMISSAOOP: Date,
        IDPLANEJAMENTO: Number,
        DATATARGET: Date,
        QTDEREALIZADA: Number,
        STATUS: String,
    },
    { collection: 'OPs' }
);

var planejamentos = new Schema(
    {
        IDPLANEJAMENTO: Number,
        DATATARGET: Date,
        AUTOR: String,
        DATACRIACAO: Date,
        STATUS: String,
    },
    { collection: 'Planejamentos' }
);

var expedientesRotinas = new Schema(
    {
        CODROTINA: Number,
        NOMEROTINA: String,
        INICIOEXPEDIENTE: String,
        FIMEXPEDIENTE: String,
        TEMPOLIMITEESPERA: String,
    },
    { collection: 'ConfiguracoesRotinas' }
);

var layouts = new Schema(
    {
        NOMELAYOUT: String,
        CODROTINA: Number,
        DESCRICAOROTINA: String,
        ORDEMVISUALIZAÇÃO: Number,
    },
    { collection: 'ConfiguracoesLayouts' }
);

var usuarioMobile = new Schema(
    {
        IDENTIFICACAO: String,
        NOME: String,
        ROTINAS: Array,
    },
    { collection: 'UsuarioMobile' }
);

var schemaOps = mongoose.model('OPs', ops);
var schemaPlanejamentos = mongoose.model('Planejamentos', planejamentos);
var schemaConfiguracoesRotinas = mongoose.model(
    'ConfiguracoesRotinas',
    expedientesRotinas
);
var schemaConfiguracoesLayouts = mongoose.model('ConfiguracoesLayouts', layouts);
var schemaUsuarioMobile = mongoose.model('UsuarioMobile', usuarioMobile);
module.exports = {
    schemaOps,
    schemaPlanejamentos,
    schemaConfiguracoesRotinas,
    schemaConfiguracoesLayouts,
    schemaUsuarioMobile,
};
