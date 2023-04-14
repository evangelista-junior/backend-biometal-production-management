const express = require('express');
const OracleDB = require('oracledb');
const mongoose = require('mongoose');
const cors = require('cors');

// Database connection
const oracle = require('./database/Oracle/connection');
const { queries } = require('./database/Oracle/queries');

const schemas = require('./database/Mongo/schemas');
const credentials = require('./database/Mongo/credentials');
mongoose.set('strictQuery', true);
mongoose
    .connect(credentials.key, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Conectado ao MongoDB'))
    .catch((err) => console.log(err));

// Create app
const app = express();
const PORT = 3333;

// MidleWares
app.use(express.json());
app.use(cors());

// Auxiliary functions

const statusPredict = (limit, endProcessBef, status) => {
    if (limit !== null) {
        let limitHour = parseInt(limit.slice(0, 2));
        let limitMinute = parseInt(limit.slice(2, 4));
        let previstDate = new Date(
            new Date(endProcessBef).getTime() +
                limitMinute * 60 * 1000 +
                limitHour * 60 * 60 * 1000
        );
        if (new Date(previstDate) < new Date() && status === 1) {
            return 5;
        } else {
            return status;
        }
    } else {
        return status;
    }
};

// Routes
app.post('/api/v1/authentication/login', async (req, res) => {
    let { user, password } = req.body;

    const connection = await oracle.connect();
    let dados = (await connection.execute(queries.login(user, password))).rows[0];
    connection.close();
    if (dados) {
        res.status(200).json({
            user: { user: dados[0], name: dados[1], email: dados[2] },
            token: dados[3],
        });
    } else {
        res.status(204).json({});
    }
});

app.post('/api/v1/authentication/validate-token', async (req, res) => {
    let token = req.body.token;

    const connection = await oracle.connect();
    let dados = (await connection.execute(queries.validateToken(token))).rows[0];
    connection.close();

    if (dados) {
        res.status(200).json({
            user: { user: dados[0], name: dados[1], email: dados[2] },
        });
    } else {
        res.status(404).json({});
    }
});

app.get('/api/v1/visualization-layouts', (req, res) => {
    schemas.schemaConfiguracoesLayouts
        .aggregate([
            {
                $group: {
                    _id: { nomeLayout: '$NOMELAYOUT' },
                },
            },
        ])
        .sort({ _id: 1 })
        .exec(async (err, data) => {
            const rotinas = {};

            const appendKeys = () => {
                return new Promise((resolve) => {
                    for (i in data) {
                        rotinas[data[i]._id.nomeLayout] = [];
                    }
                    resolve(rotinas);
                });
            };
            await appendKeys(data);

            schemas.schemaConfiguracoesLayouts
                .find({})
                .sort({ ORDEMVISUALIZAÇÃO: 1, NOMELAYOUT: 1 })
                .exec((err, d) => {
                    d.map((item) => {
                        rotinas[item.NOMELAYOUT].push([
                            item.CODROTINA,
                            item.DESCRICAOROTINA,
                        ]);
                    });

                    res.status(200).json(rotinas);
                });
        });
});

app.get('/api/v1/routines-production', async (req, res) => {
    const connection = await oracle.connect();
    const rotinas = (await connection.execute(queries.listRoutines)).rows;
    res.status(200).json(rotinas);

    connection.close();
});

app.get('/api/v1/process-map/get-last-note', async (req, res) => {
    const conn = await oracle.connect();
    const lastStartNote = (await conn.execute(queries.lastStartNote)).rows[0][0];
    const lastEndNote = (await conn.execute(queries.lastEndNote)).rows[0][0];
    const lastNote = (await conn.execute(queries.lastNote)).rows[0][0];

    conn.close();
    res.status(200).json({
        LASTSTART: lastStartNote,
        LASTEND: lastEndNote,
        LASTGENERALNOTE: lastNote,
    });
});

app.get('/api/v1/process-map/:weekYearTarget', async (req, res) => {
    // Auxilairy function
    const getLimitWaitTime = (routine) => {
        return new Promise((resolve, reject) => {
            schemas.schemaConfiguracoesRotinas
                .find({ CODROTINA: routine })
                .select('TEMPOLIMITEESPERA')
                .exec((err, data) => {
                    resolve(data[0].TEMPOLIMITEESPERA);
                });
        });
    };

    const weekYearTarget = req.params.weekYearTarget;
    const conn = await oracle.connect();
    const notes = (await conn.execute(queries.getNotes(weekYearTarget))).rows;

    // Status adjust
    var searchRoutine = null;
    var limitWaitTime = null;
    for (i in notes) {
        if (notes[i][16] && searchRoutine !== notes[i][16]) {
            searchRoutine = notes[i][16];
            limitWaitTime = await getLimitWaitTime(notes[i][16]);
        }
        notes[i][19] = statusPredict(limitWaitTime, notes[i][10], notes[i][19]);
    }

    const createKeys = () => {
        return new Promise(async (resolve, reject) => {
            let routines = (await conn.execute(queries.listRoutines)).rows;
            let processByProdType = { 700: {}, 300: {} };
            routines.map((routine) => {
                (processByProdType[700][routine[0]] = notes.filter(
                    (note) => note[16] === routine[0] && note[0] === '700'
                )),
                    (processByProdType[300][routine[0]] = notes.filter(
                        (note) => note[16] === routine[0] && note[0] === '300'
                    ));
            });
            resolve(processByProdType);
        });
    };

    const processMap = await createKeys();
    conn.close();
    res.status(200).json(processMap);
});

app.get('/api/v1/process-map/predict-realized/:weekYearTarget', async (req, res) => {
    const weekYearTarget = req.params.weekYearTarget;
    const conn = await oracle.connect();
    const results = (await conn.execute(queries.getPredictedRealizated(weekYearTarget)))
        .rows;
    const createKeys = () => {
        return new Promise(async (resolve, reject) => {
            let routines = (await conn.execute(queries.listRoutines)).rows;
            let newObject = { 700: {}, 300: {}, 1000: {} };
            if (results.length) {
                routines.map((routine) => {
                    newObject[700][routine[0]] = results.filter(
                        (result) => result[0] === routine[0] && result[4] === '700'
                    );
                    newObject[300][routine[0]] = results.filter(
                        (result) => result[0] === routine[0] && result[4] === '300'
                    );

                    let newArray = [];
                    if (
                        newObject[700][routine[0]].length &&
                        newObject[300][routine[0]].length
                    ) {
                        let fam700 = newObject[700][routine[0]][0];
                        let fam300 = newObject[300][routine[0]][0];
                        let newPred = fam700[1] + fam300[1];
                        let newReal = fam300[2] + fam700[2];
                        let newPercent = (newReal / newPred) * 100;
                        newArray = [[routine[0], newPred, newReal, newPercent, '1000']];
                    } else if (newObject[700][routine[0]].length) {
                        newArray = newObject[700][routine[0]];
                    } else if (newObject[300][routine[0]].length) {
                        newArray = newObject[300][routine[0]];
                    }
                    newObject[1000][routine[0]] = newArray;
                });
            } else {
                routines.map((routine) => {
                    let emptyArray = [[routine[0], 0, 0, 0]];
                    newObject[700][routine[0]] = emptyArray;
                    newObject[300][routine[0]] = emptyArray;
                    newObject[1000][routine[0]] = emptyArray;
                });
            }
            resolve(newObject);
        });
    };

    const predictedRealizated = await createKeys();
    conn.close();
    res.status(200).json(predictedRealizated);
});

app.get('/api/v1/time-settings/limit-time-per-routine/:routine', (req, res) => {
    const routine = req.params.routine;
    schemas.schemaConfiguracoesRotinas
        .find({ CODROTINA: routine })
        .select('TEMPOLIMITEESPERA')
        .exec((err, data) => {
            let limit = data[0].TEMPOLIMITEESPERA;
            res.status(200).json(limit);
        });
});

app.get('/api/v1/summary/list-weeks', async (req, res) => {
    let connection = await oracle.connect();
    let semanas = (await connection.execute(queries.listSummaryWeeks)).rows;
    res.status(200).json(semanas);
});

app.get('/api/v1/summary/list-orders-per-week/:weekYear', async (req, res) => {
    let weekYear = req.params.weekYear;
    let connection = await oracle.connect();
    let listOrders = (
        await connection.execute(queries.getListOrdersWeekSelected(weekYear))
    ).rows;
    let listOrdersObj = {};
    listOrdersObj[weekYear] = listOrders;

    res.status(200).json(listOrdersObj);
});

app.get('/api/v1/layouts', (req, res) => {
    schemas.schemaConfiguracoesLayouts
        .aggregate([
            {
                $group: {
                    _id: { nomeLayout: '$NOMELAYOUT' },
                },
            },
        ])
        .sort({ _id: 1 })
        .exec(async (err, data) => {
            const layouts = {};

            const appendKeys = (listRoutines) => {
                return new Promise((resolve) => {
                    for (i in data) {
                        listRoutines[data[i]._id.nomeLayout] = [];
                    }
                    resolve(listRoutines);
                });
            };
            await appendKeys(layouts);

            schemas.schemaConfiguracoesLayouts
                .find({})
                .sort({ ORDEMVISUALIZAÇÃO: 1, NOMELAYOUT: 1 })
                .exec((err, routines) => {
                    routines.map((item) => {
                        layouts[item.NOMELAYOUT].push([
                            item.CODROTINA,
                            item.DESCRICAOROTINA,
                        ]);
                    });

                    res.status(200).json(layouts);
                });
        });
});

app.post('/api/v1/layouts/create-layout', (req, res) => {
    let { LAYOUTNAME, LAYOUTROUTINES } = req.body;

    schemas.schemaConfiguracoesLayouts
        .find({ NOMELAYOUT: LAYOUTNAME })
        .exec((err, data) => {
            if (data.length === 0) {
                LAYOUTROUTINES.map((routineInfo, i) => {
                    schemas.schemaConfiguracoesLayouts.create({
                        NOMELAYOUT: LAYOUTNAME,
                        CODROTINA: routineInfo[0],
                        DESCRICAOROTINA: routineInfo[1],
                        ORDEMVISUALIZAÇÃO: i,
                    });
                });
                res.status(201).json('Layout criado com sucesso !');
            } else {
                res.status(200).json(
                    'Nome do layout já está em uso, por favor escolha outro !'
                );
            }
        });
});

app.delete('/api/v1/layouts/delete-layout/:layout', (req, res) => {
    let layout = req.params.layout.replace('_-_', ' ');

    schemas.schemaConfiguracoesLayouts
        .deleteMany({ NOMELAYOUT: layout })
        .exec((err, res) => {
            if (err) console.log(err);
        });
    res.status(200);
});

app.get('/api/v1/time-settings', async (req, res) => {
    const connection = await oracle.connect();
    const routines = (await connection.execute(queries.listRoutines)).rows;
    connection.close();

    routines.forEach((row, i) => {
        schemas.schemaConfiguracoesRotinas
            .findOne({ CODROTINA: row[0] })
            .exec((err, data) => {
                if (data === null) {
                    schemas.schemaConfiguracoesRotinas.create({
                        CODROTINA: row[0],
                        NOMEROTINA: row[1],
                        INICIOEXPEDIENTE: '0700',
                        FIMEXPEDIENTE: '1648',
                        TEMPOLIMITEESPERA: null,
                    });
                } else if (data.NOMEROTINA != row[1]) {
                    schemas.schemaConfiguracoesRotinas
                        .updateOne(
                            { CODROTINA: row[0] },
                            {
                                NOMEROTINA: row[1],
                                INICIOEXPEDIENTE: '0700',
                                FIMEXPEDIENTE: '1648',
                                TEMPOLIMITEESPERA: null,
                            }
                        )
                        .exec((err, data) => {
                            if (err) {
                                console.log(err);
                            }
                        });
                }
            });
    });

    schemas.schemaConfiguracoesRotinas
        .find({})
        .select('CODROTINA NOMEROTINA INICIOEXPEDIENTE FIMEXPEDIENTE TEMPOLIMITEESPERA')
        .sort({ NOMEROTINA: 1 })
        .exec((err, data) => {
            res.status(200).json(data);
        });
});

app.patch('/api/v1/time-settings/update-start-end-work', (req, res) => {
    const { _id, INICIOEXPEDIENTE, FIMEXPEDIENTE } = req.body;
    schemas.schemaConfiguracoesRotinas
        .updateOne(
            { _id: _id },
            {
                INICIOEXPEDIENTE: INICIOEXPEDIENTE.replace(':', ''),
                FIMEXPEDIENTE: FIMEXPEDIENTE.replace(':', ''),
            }
        )
        .exec((err, data) => {
            if (err) {
                console.log(err);
            }
        });

    res.status(204);
});

app.patch('/api/v1/time-settings/update-wait-time', (req, res) => {
    const { _id, TEMPOLIMITEESPERA } = req.body;
    schemas.schemaConfiguracoesRotinas
        .updateOne(
            { _id: _id },
            {
                TEMPOLIMITEESPERA: TEMPOLIMITEESPERA.replace(':', ''),
            }
        )
        .exec((err, data) => {
            if (err) {
                console.log(err);
            }
        });

    res.status(204);
});

app.get('/api/v1/mobile/available-users', async (req, res) => {
    const conn = await oracle.connect();
    let availableUsers = (await conn.execute(queries.availableUsers)).rows;
    conn.close();

    schemas.schemaUsuarioMobile.find({}).exec((err, data) => {
        let registeredUsers = data.map((user) => user.NOME);
        availableUsers = availableUsers.filter(
            (user) => !registeredUsers.includes(user[1])
        );

        res.status(200).json(availableUsers);
    });
});

app.get('/api/v1/mobile/users', (req, res) => {
    schemas.schemaUsuarioMobile.find({}).exec((err, data) => {
        res.status(200).json(data);
    });
});

app.post('/api/v1/mobile/users', (req, res) => {
    let { IDENTIFICACAO, NOME, ROTINAS } = req.body;
    schemas.schemaUsuarioMobile.create({
        IDENTIFICACAO: IDENTIFICACAO,
        NOME: NOME,
        ROTINAS: ROTINAS,
    });

    res.status(201).json('Usuário cadastrado com sucesso !');
});

app.delete('/api/v1/mobile/users/:userId', (req, res) => {
    let userId = req.params.userId.replace('_', ' ');
    schemas.schemaUsuarioMobile.deleteOne({ _id: userId }).exec((err, res) => {
        if (err) console.log(err);
    });
    res.status(200);
});

app.get('/api/v1/mobile/users/:id', (req, res) => {
    let id = req.params.id;
    schemas.schemaUsuarioMobile
        .findOne({
            IDENTIFICACAO: id,
        })
        .exec((err, data) => {
            data
                ? res.status(200).json(data)
                : res.status(204).json('Usuário não encontrado');
        });
});

app.get('/api/v1/mobile/process-map/:weekYearTarget/:routines', async (req, res) => {
    // Auxilairy function
    const getLimitWaitTime = (routine) => {
        return new Promise((resolve, reject) => {
            schemas.schemaConfiguracoesRotinas
                .find({ CODROTINA: routine })
                .select('TEMPOLIMITEESPERA')
                .exec((err, data) => {
                    resolve(data[0].TEMPOLIMITEESPERA);
                });
        });
    };

    const { weekYearTarget, routines } = req.params;
    const conn = await oracle.connect();
    const notes = (await conn.execute(queries.getNotesMobile(weekYearTarget, routines)))
        .rows;

    var searchRoutine = null;
    var limitWaitTime = null;
    for (let i = 0; i < notes.length; i++) {
        if (notes[i]) {
            if (notes[i][16] && searchRoutine !== notes[i][16]) {
                searchRoutine = notes[i][16];
                limitWaitTime = await getLimitWaitTime(notes[i][16]);
            }
            notes[i][19] = statusPredict(limitWaitTime, notes[i][10], notes[i][19]);
        }
    }

    const createKeys = () => {
        return new Promise(async (resolve, reject) => {
            let routines = (await conn.execute(queries.listRoutines)).rows;
            let processByProdType = {};

            routines.map((routine) => {
                if (!Object.keys(processByProdType).includes(routine[0])) {
                    processByProdType[routine[0]] = [];
                }
                processByProdType[routine[0]] = notes.filter(
                    (note) => note[16] === routine[0]
                );
            });
            resolve(processByProdType);
        });
    };

    const processMap = await createKeys();
    conn.close();
    res.status(200).json(processMap);
});

// run server
app.listen(PORT, () => console.log('listening on port ' + PORT));
