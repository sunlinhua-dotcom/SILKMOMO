import Image from 'next/image';

export default function LogoPreview() {
    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-10 gap-10">
            <h1 className="text-3xl font-bold text-gray-800">Logo Preview</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {/* Dark Background Preview */}
                <div className="flex flex-col items-center gap-4">
                    <h2 className="text-lg font-medium text-gray-600">Dark Background (Original)</h2>
                    <div className="p-8 bg-neutral-900 rounded-3xl shadow-2xl border border-neutral-800">
                        <Image src="/logo.svg" alt="Logo" width={400} height={400} className="w-64 h-64 object-contain" />
                    </div>
                </div>

                {/* Light Background Preview (Simulated) */}
                <div className="flex flex-col items-center gap-4">
                    <h2 className="text-lg font-medium text-gray-600">Sizes</h2>
                    <div className="flex items-end gap-4 p-8 bg-white rounded-3xl shadow-xl border border-gray-100">
                        <Image src="/logo.svg" alt="Logo Small" width={64} height={64} className="w-16 h-16 rounded-lg shadow-md" />
                        <Image src="/logo.svg" alt="Logo Medium" width={128} height={128} className="w-32 h-32 rounded-xl shadow-lg" />
                    </div>
                </div>
            </div>

            <p className="text-gray-500 max-w-xl text-center">
                This SVG logo uses a vector path to simulate a silk ribbon 'S' shape with a golden gradient.
                It is scalable to any size without losing quality.
            </p>
        </div>
    );
}
