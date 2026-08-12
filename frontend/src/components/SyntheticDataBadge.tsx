/**
 * Avviso per le pagine che disegnano dati non reali.
 * /gex e /spx-gamma leggono da /api/gex, che genera gamma exposure
 * casuale: senza questo badge il grafico e' indistinguibile da uno
 * costruito su dati di mercato veri.
 */
export default function SyntheticDataBadge() {
    return (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <span className="mt-0.5 text-lg leading-none text-amber-400">⚠</span>
            <div className="text-sm">
                <div className="font-semibold text-amber-300">DATI SIMULATI</div>
                <div className="text-amber-200/80">
                    Gamma exposure generata casualmente, non è un dato di mercato reale.
                    Solo il prezzo SPX di riferimento proviene da una fonte esterna.
                </div>
            </div>
        </div>
    );
}
